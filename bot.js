// misskey-bcdice-bot.js
const WebSocket = require('ws');
const axios = require('axios');
const fs = require('fs');
require('dotenv').config();

// 설정값
const HOST = process.env.MISSKEY_API_URL;
const TOKEN = process.env.MISSKEY_TOKEN;
const BOT_USER_ID = process.env.BOT_USER_ID;
const STREAM_URL = `${HOST.replace(/^http/, 'ws')}/streaming?i=${TOKEN}`;

// 사용자 별 시스템 설정 저장
const userSystems = {};
const SYSTEMS_FILE = './userSystems.json';

function saveSystems() {
  fs.writeFileSync(SYSTEMS_FILE, JSON.stringify(userSystems, null, 2));
}

function loadSystems() {
  if (fs.existsSync(SYSTEMS_FILE)) {
    Object.assign(userSystems, JSON.parse(fs.readFileSync(SYSTEMS_FILE)));
  }
}

loadSystems();

// Misskey에 답글 작성
async function post(text, replyToId = null) {
  try {
    const payload = { i: TOKEN, text };
    if (replyToId) payload.replyId = replyToId;
    await axios.post(`${HOST}/api/notes/create`, payload);
    console.log('✅ 답글 전송 완료');
  } catch (err) {
    console.error('📡 메시지 전송 오류:', err.message);
  }
}

// 시스템 리스트 요청
async function fetchSystemList() {
  try {
    const res = await axios.get('https://bcdice.kazagakure.net/v2/game_system');
    return res.data;
  } catch (err) {
    console.error('📥 시스템 목록 가져오기 실패:', err.message);
    return [];
  }
}

// 주사위 굴리기
async function rollDice(command, system) {
  try {
    const url = `https://bcdice.kazagakure.net/v2/game_system/${system}/roll`;
    const res = await axios.get(url, { params: { command } });
    if (res.data.ok) return res.data.text || '[결과 없음]';
    return `❌ 오류: ${res.data.reason}`;
  } catch (err) {
    console.error('🎲 주사위 API 오류:', err.message);
    return '❌ 주사위 서버 오류';
  }
}

function getSystemForUser(userId) {
  return userSystems[userId] || 'DiceBot';
}

// WebSocket 연결
const ws = new WebSocket(STREAM_URL);

ws.on('open', () => {
  console.log('✅ Streaming 연결됨');
  const streamMessage = {
    type: 'connect',
    body: { channel: 'homeTimeline', id: 'homeTimeline' },
  };
  ws.send(JSON.stringify(streamMessage));
});

ws.on('message', async (data) => {
  try {
    const msg = JSON.parse(data);
    if (msg.type !== 'channel') return;

    const note = msg.body.body;
    const content = note.text || '';
    const mentions = note.mentions || [];
    const isBotMentioned = mentions.some(m => m.id === BOT_USER_ID);
    if (!isBotMentioned) return;

    const pureText = content.replace(/@\S+/g, '').trim();

    // 시스템 설정
    const systemSet = pureText.match(/시스템\s*[:：]\s*(\S+)/i);
    if (systemSet) {
      const system = systemSet[1];
      userSystems[note.user.id] = system;
      saveSystems();
      await post(`@${note.user.username} ✅ 시스템을 '${system}'으로 설정했어요!`, note.id);
      return;
    }

    // 시스템 확인
    if (/시스템\s*확인/.test(pureText)) {
      const system = getSystemForUser(note.user.id);
      await post(`@${note.user.username} 🎯 현재 설정된 시스템은 '${system}'입니다.`, note.id);
      return;
    }

    // 시스템 초기화
    if (/시스템\s*초기화/.test(pureText)) {
      delete userSystems[note.user.id];
      saveSystems();
      await post(`@${note.user.username} ♻️ 시스템을 기본값(DiceBot)으로 초기화했어요.`, note.id);
      return;
    }

    // 시스템 목록
    if (/시스템\s*목록/.test(pureText)) {
      const systems = await fetchSystemList();
      if (systems.length === 0) {
        await post(`@${note.user.username} ⚠️ 시스템 목록을 가져오지 못했어요.`, note.id);
      } else {
        const names = systems.map(s => s.id).slice(0, 20);
        await post(`@${note.user.username} 🎲 사용 가능한 시스템 목록:\n- ` + names.join('\n- '), note.id);
      }
      return;
    }

    // 주사위 커맨드 전달 (전체 텍스트 그대로)
    const system = getSystemForUser(note.user.id);
    const result = await rollDice(pureText, system);
    await post(`@${note.user.username} 🎲 결과: ${result}`, note.id);

  } catch (err) {
    console.error('💥 처리 중 오류:', err.message);
  }
});
