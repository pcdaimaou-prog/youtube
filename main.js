const express = require('express');
const lt = require('localtunnel');
const fs = require('fs');
const { execSync } = require('child_process');
const mineflayer = require('mineflayer');
const fetch = require('node-fetch');
const args = require('minimist')(process.argv.slice(2));

// --- 設定エリア ---
const PORT = 8080;
const TUNNEL_SUBDOMAIN = `mc-ai-project-${Math.floor(Math.random() * 10000)}`;
const CONTROL_URL = `https://${TUNNEL_SUBDOMAIN}.loca.lt`;
const SAVE_PATH = './progress.json';

// --- モード分岐 ---

if (args.mode === 'server') {
    // 【管理サーバーモード】
    const app = express();
    app.use(express.json());
    let pData = fs.existsSync(SAVE_PATH) ? JSON.parse(fs.readFileSync(SAVE_PATH)) : {};

    app.get('/config/:id', (req, res) => {
        res.json({
            task: "巨大な塔を建築せよ",
            last_memo: pData[req.params.id] || "未着手",
            range: "100 64 100 | 150 90 150"
        });
    });

    app.post('/report', (req, res) => {
        console.log(`[報告] ${req.body.name}: ${req.body.msg}`);
        // メモリ上の進捗を更新
        pData[req.body.pairId] = req.body.msg;
        res.sendStatus(200);
    });

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
