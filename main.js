const args = require('minimist')(process.argv.slice(2));
const fs = require('fs');
const { execSync } = require('child_process');
const fetch = require('node-fetch');

// --- ユニーク設定 (ここをリポジトリ名などに変えるとURLが安定します) ---
const SUBDOMAIN = `mc-ai-lab-${Math.floor(Math.random() * 9000) + 1000}`; 
const CONTROL_URL = `https://${SUBDOMAIN}.loca.lt`;
const MC_CONFIG = {
    host: 'youtube.logic-archive.f5.si', // あなたのマイクラサーバーIP
    port: 25565
};

// ==========================================
// モード1: 管理サーバー (server)
// ==========================================
if (args.mode === 'server') {
    const express = require('express');
    const lt = require('localtunnel');
    const app = express();
    app.use(express.json());

    let chatData = {}; // ペア会話保持
    let progressData = {}; // 進捗報告保持

    // 設定配信 (ペアごとの座標範囲)
    app.get('/config/:pairId', (req, res) => {
        const id = req.params.pairId;
        const offset = (id - 1) * 30; // ペアごとに30ブロックずつずらす
        res.json({
            task: "ペアで協力して独自の塔を建てなさい",
            range: {
                min: [100 + offset, 64, 100],
                max: [120 + offset, 90, 120]
            }
        });
    });

    // 会話システム (送受信)
    app.post('/chat/:pairId', (req, res) => {
        const id = req.params.pairId;
        if (!chatData[id]) chatData[id] = [];
        chatData[id].push({ from: req.body.name, text: req.body.text, time: Date.now() });
        if (chatData[id].length > 5) chatData[id].shift();
        res.sendStatus(200);
    });

    app.get('/chat/:pairId', (req, res) => {
        res.json(chatData[req.params.pairId] || []);
    });

    // 進捗レポート
    app.post('/report', (req, res) => {
        progressData[req.body.name] = req.body.msg;
        console.log(`[PROGRESS] ${req.body.name}: ${req.body.msg}`);
        res.sendStatus(200);
    });

    const server = app.listen(8080, async () => {
        const ip = await fetch('https://ifconfig.me/ip').then(r => r.text());
        const tunnel = await lt({ port: 8080, subdomain: SUBDOMAIN });
        
        console.log("\n" + "=".repeat(50));
        console.log("💎 管理サーバー起動成功");
        console.log(`🔗 URL: ${tunnel.url}`);
        console.log(`🔑 Tunnel Password (IP): ${ip.trim()}`);
        console.log("=".repeat(50) + "\n");
    });

// ==========================================
// モード2: AIボット (bot)
// ==========================================
} else if (args.mode === 'bot') {
    const mineflayer = require('mineflayer');

    async function runBot() {
        console.log(`[${args.name}] 司令塔への接続を試行中...`);
        let config = null;
        
        // サーバー起動まで最大10分間リトライ
        for (let i = 0; i < 60; i++) {
            try {
                const res = await fetch(`${CONTROL_URL}/config/${args.pair}`);
                if (res.ok) { config = await res.json(); break; }
            } catch (e) { await new Promise(r => setTimeout(r, 10000)); }
        }

        if (!config) { console.error("サーバーに接続できませんでした。"); process.exit(1); }

        const bot = mineflayer.createBot({
            host: MC_CONFIG.host, port: MC_CONFIG.port,
            username: args.name, version: "1.20.1"
        });

        // 55分後の保存 (Role Aのみ)
        setTimeout(async () => {
            if (args.role === 'A') {
                const fileName = `progress_p${args.pair}.json`;
                fs.writeFileSync(fileName, JSON.stringify({ pair: args.pair, status: "55min checkpoint", date: new Date() }));
                try {
                    execSync(`git config user.name "AI-Architect" && git config user.email "bot@example.com"`);
                    execSync(`git add ${fileName} && git commit -m "Save P${args.pair}" && git push origin main`);
                    console.log(`[SYSTEM] Pair ${args.pair} data saved.`);
                } catch (e) { console.log("Save skipped."); }
            }
            process.exit(0);
        }, 3300000);

        bot.on('spawn', async () => {
            // 自動移動
            const targetX = (config.range.min[0] + config.range.max[0]) / 2;
            const targetZ = (config.range.min[2] + config.range.max[2]) / 2;
            bot.chat(`/tp ${targetX} ${config.range.min[1]} ${targetZ}`);
            
            while (true) {
                try {
                    // 相方の会話を取得
                    const chatHistory = await fetch(`${CONTROL_URL}/chat/${args.pair}`).then(r => r.json());
                    const partnerChat = chatHistory.filter(c => c.from !== args.name).pop();

                    const prompt = `あなたは建築AI。ペアの相手:${args.role==='A'?'B':'A'}。
                    相手の発言: ${partnerChat ? partnerChat.text : "なし"}
                    範囲: X(${config.range.min[0]}~${config.range.max[0]}), Z(${config.range.min[2]}~${config.range.max[2]})
                    JSONで返せ: {"chat": "相手への相談", "block": "stone", "x": ${targetX}, "y": 64, "z": ${targetZ}, "msg": "進捗報告"}`;

                    const aiRes = await fetch('http://localhost:11434/api/generate', {
                        method: 'POST',
                        body: JSON.stringify({ model: "llama3:8b-instruct-q4_0", prompt, stream: false, format: "json" })
                    }).then(r => r.json());

                    const plan = JSON.parse(aiRes.response);

                    // 行動実行
                    if (plan.chat) {
                        bot.chat(`(TeamMsg) ${plan.chat}`);
                        await fetch(`${CONTROL_URL}/chat/${args.pair}`, {
                            method: 'POST',
                            headers: {'Content-Type': 'application/json'},
                            body: JSON.stringify({ name: args.name, text: plan.chat })
                        });
                    }
                    bot.chat(`/setblock ${plan.x} ${plan.y} ${plan.z} ${plan.block}`);
                    await fetch(`${CONTROL_URL}/report`, {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({ name: args.name, pairId: args.pair, msg: plan.msg })
                    });
                } catch (e) { console.log("AI Loop Wait..."); }
                await new Promise(r => setTimeout(r, 15000));
            }
        });
    }
    runBot();
}
