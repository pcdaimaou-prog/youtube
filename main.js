const mineflayer = require('mineflayer');
const fetch = require('node-fetch');
const args = require('minimist')(process.argv.slice(2));
const fs = require('fs');
const { execSync } = require('child_process');

// 1. Formからの設定をパース
const [task, pos1, pos2] = args.config.split('|').map(s => s.trim());
const p1 = pos1.split(' ').map(Number);
const p2 = pos2.split(' ').map(Number);
const bounds = {
    minX: Math.min(p1[0], p2[0]), maxX: Math.max(p1[0], p2[0]),
    minY: Math.min(p1[1], p2[1]), maxY: Math.max(p1[1], p2[1]),
    minZ: Math.min(p1[2], p2[2]), maxZ: Math.max(p1[2], p2[2])
};

const partnerName = `Bot-${args.pair}-${args.role === 'A' ? 'B' : 'A'}`;
let partnerMemory = []; // 相方の発言履歴

const bot = mineflayer.createBot({
    host: args.host,
    port: 25565,
    username: args.name,
    version: "1.20.1"
});

// チャットを監視して相方の言葉を覚える
bot.on('chat', (username, message) => {
    if (username === partnerName) {
        partnerMemory.push(message);
        if (partnerMemory.length > 5) partnerMemory.shift();
    }
});

// 55分後の進捗保存
setTimeout(async () => {
    if (args.role === 'A') {
        const fileName = `progress_p${args.pair}.json`;
        fs.writeFileSync(fileName, JSON.stringify({ pair: args.pair, task, date: new Date() }));
        try {
            execSync('git config user.name "AI-Architect" && git config user.email "bot@example.com"');
            execSync(`git add ${fileName} && git commit -m "Auto-save P${args.pair}" && git push origin main`);
        } catch (e) { console.log("Save skipped."); }
    }
    process.exit(0);
}, 3300000);

bot.on('spawn', async () => {
    // 範囲中央へTP
    const tx = (bounds.minX + bounds.maxX) / 2;
    const tz = (bounds.minZ + bounds.maxZ) / 2;
    bot.chat(`/tp ${tx} ${bounds.minY} ${tz}`);

    while (true) {
        const prompt = `あなたは建築AIです。
【指示】${task}
【範囲】X:${bounds.minX}~${bounds.maxX}, Y:${bounds.minY}~${bounds.maxY}, Z:${bounds.minZ}~${bounds.maxZ}
【相方の直近の発言】${partnerMemory.join(' | ') || "なし"}
相方(${partnerName})と協力し、範囲内を建築せよ。
JSONで返せ: {"chat": "相方への相談", "block": "stone", "x": ${tx}, "y": 64, "z": ${tz}}`;

        try {
            const aiRes = await fetch('http://localhost:11434/api/generate', {
                method: 'POST',
                body: JSON.stringify({ model: "llama3:8b-instruct-q4_0", prompt, stream: false, format: "json" })
            }).then(r => r.json());

            const plan = JSON.parse(aiRes.response);
            if (plan.chat) bot.chat(plan.chat);
            
            // 範囲内チェック
            if (plan.x >= bounds.minX && plan.x <= bounds.maxX && plan.z >= bounds.minZ && plan.z <= bounds.maxZ) {
                bot.chat(`/setblock ${Math.floor(plan.x)} ${Math.floor(plan.y)} ${Math.floor(plan.z)} ${plan.block}`);
            }
        } catch (e) { console.log("AI Thinking..."); }
        await new Promise(r => setTimeout(r, 15000));
    }
});
