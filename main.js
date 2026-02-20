const args = require('minimist')(process.argv.slice(2));
const fs = require('fs');
const { execSync } = require('child_process');

// --- 共通設定 ---
const PORT = 8080;
const SUBDOMAIN = `mc-ai-project-${Math.floor(Math.random() * 9999)}`;
const CONTROL_URL = `https://${SUBDOMAIN}.loca.lt`;

// --- モード1: 管理サーバー (server) ---
if (args.mode === 'server') {
    const express = require('express');
    const lt = require('localtunnel');
    const app = express();
    app.use(express.json());

    let pairData = {}; 
    let chatRelay = {}; 

    app.get('/config/:id', (req, res) => {
        const saveFile = `./progress_p${req.params.id}.json`;
        const lastData = fs.existsSync(saveFile) ? JSON.parse(fs.readFileSync(saveFile)) : { memo: "開始前" };
        res.json({
            task: "ペアで協力して巨大な城門を建築せよ",
            last_memo: lastData.memo,
            range: { min: [100, 64, 100], max: [130, 90, 130] }
        });
    });

    app.post('/chat/:id', (req, res) => {
        if (!chatRelay[req.params.id]) chatRelay[req.params.id] = [];
        chatRelay[req.params.id].push(`${req.body.from}: ${req.body.text}`);
        if (chatRelay[req.params.id].length > 10) chatRelay[req.params.id].shift();
        res.sendStatus(200);
    });

    app.get('/chat/:id', (req, res) => res.json(chatRelay[req.params.id] || []));

    app.post('/report', (req, res) => {
        pairData[req.body.pairId] = req.body.msg;
        console.log(`[Pair ${req.body.pairId}] ${req.body.name}: ${req.body.msg}`);
        res.sendStatus(200);
    });

    app.listen(PORT, async () => {
        try {
            const tunnel = await lt({ port: PORT, subdomain: SUBDOMAIN });
            console.log(`\n==========================================`);
            console.log(`【管理画面URL】: ${tunnel.url}`);
            console.log(`==========================================\n`);
        } catch (err) {
            console.error("Localtunnel Error:", err);
        }
    });

// --- モード2: AIボット (bot) ---
} else if (args.mode === 'bot') {
    const mineflayer = require('mineflayer');
    const fetch = require('node-fetch');

    async function runBot() {
        let config = null;
        // サーバーが立ち上がるまでリトライ
        while (!config) {
            try {
                const res = await fetch(`${CONTROL_URL}/config/${args.pair}`);
                if (res.ok) {
                    config = await res.json();
                } else {
                    throw new Error();
                }
            } catch (e) {
                console.log(`[${args.name}] サーバー待機中... URL: ${CONTROL_URL}`);
                await new Promise(r => setTimeout(r, 10000));
            }
        }

        const bot = mineflayer.createBot({
            host: 'youtube.logic-archive.f5.si', 
            port: 25565,
            username: args.name,
            version: "1.20.1"
        });

        // 55分後の保存処理 (Role Aのみ)
        setTimeout(async () => {
            if (args.role === 'A') {
                const saveFile = `progress_p${args.pair}.json`;
                const content = JSON.stringify({ pair: args.pair, memo: `最終報告: 建築完了`, date: new Date() });
                fs.writeFileSync(saveFile, content);
                try {
                    execSync('git config user.name "AI-Builder"');
                    execSync('git config user.email "bot@example.com"');
                    execSync(`git add ${saveFile}`);
                    execSync(`git commit -m "Auto-save Pair ${args.pair}"`);
                    execSync('git push origin main');
                    console.log(`[SAVE] Pair ${args.pair} saved.`);
                } catch (e) { console.log("Git push skipped."); }
            }
            process.exit(0);
        }, 3300000);

        bot.on('spawn', async () => {
            // 指定座標へ移動
            const midX = Math.floor((config.range.min[0] + config.range.max[0]) / 2);
            const midZ = Math.floor((config.range.min[2] + config.range.max[2]) / 2);
            bot.chat(`/tp ${midX} ${config.range.min[1]} ${midZ}`);
            
            while (true) {
                try {
                    const chats = await fetch(`${CONTROL_URL}/chat/${args.pair}`).then(r => r.json());
                    const prompt = `Minecraft協力建築。相方の発言: ${chats.slice(-2).join(' | ')}。範囲内(X:${config.range.min[0]}~${config.range.max[0]})で次の一手をJSONで返せ。`;

                    const aiRes = await fetch('http://localhost:11434/api/generate', {
                        method: 'POST',
                        body: JSON.stringify({ model: "llama3:8b-instruct-q4_0", prompt, stream: false, format: "json" })
                    }).then(r => r.json());

                    const plan = JSON.parse(aiRes.response);

                    if (plan.chat) {
                        bot.chat(`(Team) ${plan.chat}`);
                        await fetch(`${CONTROL_URL}/chat/${args.pair}`, {
                            method: 'POST',
                            headers: {'Content-Type': 'application/json'},
                            body: JSON.stringify({ from: args.name, text: plan.chat })
                        });
                    }
                    bot.chat(`/setblock ${plan.x} ${plan.y} ${plan.z} ${plan.block}`);
                    await fetch(`${CONTROL_URL}/report`, {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({ name: args.name, pairId: args.pair, msg: plan.status || "建築中" })
                    });
                } catch (e) { console.log("AI Loop Error"); }
                await new Promise(r => setTimeout(r, 15000));
            }
        });

        bot.on('error', err => console.log("Bot Error:", err));
        bot.on('kicked', reason => console.log("Bot Kicked:", reason));
    }
    runBot();
}
