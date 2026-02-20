const args = require('minimist')(process.argv.slice(2));
const fs = require('fs');
const { execSync } = require('child_process');

// --- 共通設定 ---
const PORT = 8080;
const SUBDOMAIN = `mc-ai-project-${Math.floor(Math.random() * 9999)}`;
const CONTROL_URL = `https://${SUBDOMAIN}.loca.lt`;

// --- モード1: 管理サーバー (ペア会話リレー & 進捗ハブ) ---
if (args.mode === 'server') {
    const express = require('express');
    const lt = require('localtunnel');
    const app = express();
    app.use(express.json());

    let pairData = {}; // 進捗ログ
    let chatRelay = {}; // ペア内会話

    app.get('/config/:id', (req, res) => {
        // 各ペア用の進捗ファイルを読み込んでAIに渡す
        const saveFile = `./progress_p${req.params.id}.json`;
        const lastData = fs.existsSync(saveFile) ? JSON.parse(fs.readFileSync(saveFile)) : { memo: "開始前" };
        res.json({
            task: "ペアで協力して巨大な城門を建築せよ",
            last_memo: lastData.memo,
            range: { min: [100, 64, 100], max: [130, 90, 130] }
        });
    });

    // ペア内チャットのリレー
    app.post('/chat/:id', (req, res) => {
        if (!chatRelay[req.params.id]) chatRelay[req.params.id] = [];
        chatRelay[req.params.id].push(`${req.body.from}: ${req.body.text}`);
        if (chatRelay[req.params.id].length > 10) chatRelay[req.params.id].shift();
        res.sendStatus(200);
    });

    app.get('/chat/:id', (req, res) => res.json(chatRelay[req.params.id] || []));

    // 進捗報告の集約
    app.post('/report', (req, res) => {
        pairData[req.body.pairId] = req.body.msg;
        console.log(`[Pair ${req.body.pairId}] ${req.body.name}: ${req.body.msg}`);
        res.sendStatus(200);
    });

    app.listen(PORT, async () => {
        const tunnel = await lt({ port: PORT, subdomain: SUBDOMAIN });
        console.log(`\n【管理画面URL】: ${tunnel.url}\n`);
    });

// --- モード2: AIボット (建築・会話・保存) ---
} else if (args.mode === 'bot') {
    const mineflayer = require('mineflayer');
    const fetch = require('node-fetch');

    async function runBot() {
        let config = null;
        while (!config) {
            try {
                const res = await fetch(`${CONTROL_URL}/config/${args.pair}`);
                if (res.ok) config = await res.json();
            } catch (e) {
                console.log("Waiting for server...");
                await new Promise(r => setTimeout(r, 7000));
            }
        }

        const bot = mineflayer.createBot({
            host: 'youtube.logic-archive.f5.si', // マイクラサーバーIP
            port: 25565,
            username: args.name,
            version: "1.20.1"
        });

        // 55分後の保存処理 (ロールAのボットのみが実行して競合回避)
        setTimeout(async () => {
            if (args.role === 'A') {
                const saveFile = `progress_p${args.pair}.json`;
                // サーバーから最新の相方の情報も含めて取得（簡略化のため今の自分の認識を保存）
                const content = JSON.stringify({ pair: args.pair, memo: `Pair ${args.pair} の最終進捗記録`, date: new Date() });
                fs.writeFileSync(saveFile, content);
                try {
                    execSync('git config user.name "AI-Builder"');
                    execSync('git config user.email "bot@example.com"');
                    execSync(`git add ${saveFile}`);
                    execSync(`git commit -m "Save Progress Pair ${args.pair}"`);
                    execSync('git push origin main');
                    console.log(`[SAVE] Pair ${args.pair} saved successfully.`);
                } catch (e) { console.log("Git Save Error (No changes?)"); }
            }
            process.exit(0);
        }, 3300000);

        bot.on('spawn', async () => {
            // 1. 指定範囲の中心へ自動移動 (OP権限がある前提で/tp、なければ歩行)
            const midX = Math.floor((config.range.min[0] + config.range.max[0]) / 2);
            const midZ = Math.floor((config.range.min[2] + config.range.max[2]) / 2);
            bot.chat(`/tp ${midX} ${config.range.min[1]} ${midZ}`);
            bot.chat(`ペア${args.pair}、担当エリアに到着。建築を開始する。`);

            while (true) {
                // 相方の発言を取得
                const chats = await fetch(`${CONTROL_URL}/chat/${args.pair}`).then(r => r.json());
                
                const prompt = `あなたはMinecraft AI建築士です。
                【ペア】${args.pair}のパートナー(${args.role === 'A' ? 'B' : 'A'})と協力せよ。
                【範囲】X:${config.range.min[0]}~${config.range.max[0]}, Z:${config.range.min[2]}~${config.range.max[2]}
                【相方の発言】${chats.slice(-3).join(' | ')}
                【前回の進捗】${config.last_memo}
                【出力】JSON形式 {"chat": "相方への返事", "block": "block_id", "x": 110, "y": 64, "z": 110, "status": "今の進捗"}
                建築範囲を守り、相方と違う部分を作れ。`;

                try {
                    const aiRes = await fetch('http://localhost:11434/api/generate', {
                        method: 'POST',
                        body: JSON.stringify({ model: "llama3:8b-instruct-q4_0", prompt, stream: false, format: "json" })
                    }).then(r => r.json());

                    const plan = JSON.parse(aiRes.response);

                    // 会話と建築の実行
                    if (plan.chat) {
                        bot.chat(`(TeamMsg) ${plan.chat}`);
                        await fetch(`${CONTROL_URL}/chat/${args.pair}`, {
                            method: 'POST',
                            headers: {'Content-Type': 'application/json'},
                            body: JSON.stringify({ from: args.name, text: plan.chat })
                        });
                    }
                    
                    bot.chat(`/setblock ${plan.x} ${plan.y} ${plan.z} ${plan.block}`);
                    
                    // サーバーへ進捗報告
                    await fetch(`${CONTROL_URL}/report`, {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({ name: args.name, pairId: args.pair, msg: plan.status })
                    });
                } catch (e) { console.error("AI Error"); }

                await new Promise(r => setTimeout(r, 15000)); // 15秒に1回思考
            }
        });
    }
    runBot();
}
    app.listen(PORT, async () => {
        console.log(`[SERVER] Internal Port: ${PORT}`);
        const tunnel = await lt({ port: PORT, subdomain: TUNNEL_SUBDOMAIN });
        console.log("\n==========================================");
        console.log(`【管理画面URL】: ${tunnel.url}`);
        console.log("==========================================\n");
    });

} else if (args.mode === 'bot') {
    // 【AIボットモード】
    async function runBot() {
        console.log(`[${args.name}] 起動準備中...`);
        
        // 55分後に進捗をリポジトリへ保存するタイマー
        setTimeout(async () => {
            console.log("--- 終了5分前: 進捗をリポジトリへ保存します ---");
            try {
                execSync('git config user.name "AI-Builder-Bot"');
                execSync('git config user.email "bot@example.com"');
                execSync(`git add ${SAVE_PATH} || true`);
                execSync('git commit -m "Auto-save progress" || true');
                execSync('git push origin main || true');
            } catch (e) { console.error("Save Error", e.message); }
            process.exit(0);
        }, 3300000); // 55分

        // サーバー接続リトライループ
        let config;
        while (!config) {
            try {
                const res = await fetch(`${CONTROL_URL}/config/${args.pair}`);
                config = await res.json();
            } catch (e) {
                console.log("サーバー待機中...");
                await new Promise(r => setTimeout(r, 5000));
            }
        }

        const bot = mineflayer.createBot({ host: 'YOUR_MC_IP', port: 25565, username: args.name });

        bot.on('spawn', async () => {
            bot.chat(`${args.name}参上！前回の進捗: ${config.last_memo}`);
            while (true) {
                // AI思考 & 建築ロジック (Ollama呼び出し)
                const prompt = `指示:${config.task}。座標:${bot.entity.position}。JSONで次の一手を返せ。`;
                const aiRes = await fetch('http://localhost:11434/api/generate', {
                    method: 'POST',
                    body: JSON.stringify({ model: "llama3:8b-instruct-q4_0", prompt, stream: false, format: "json" })
                }).then(r => r.json());
                
                const plan = JSON.parse(aiRes.response);
                bot.chat(`/setblock ${plan.x} ${plan.y} ${plan.z} ${plan.block}`);

                // サーバーへ報告
                await fetch(`${CONTROL_URL}/report`, {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ name: args.name, pairId: args.pair, msg: `${plan.block}設置完了` })
                });
                await new Promise(r => setTimeout(r, 10000));
            }
        });
    }
    runBot();
}
