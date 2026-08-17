import { USER_VOCAB_KEY } from '../core/settings.js';
import type { ExtensionRequest, ExtensionResponse } from '../core/messages.js';

const select = document.getElementById('dict') as HTMLSelectElement;
const vocabInput = document.getElementById('vocab') as HTMLInputElement;
const status = document.getElementById('status') as HTMLElement;

function send(msg: ExtensionRequest): Promise<ExtensionResponse> {
  return chrome.runtime.sendMessage(msg);
}

async function onChange(): Promise<void> {
  const res = await send({ type: 'SET_ACTIVE_DICTIONARY', id: select.value });
  status.textContent = res.type === 'SET_OK' ? '已保存' : '保存失败';
}

async function onVocabChange(): Promise<void> {
  const raw = vocabInput.value.trim();
  if (!raw) {
    await chrome.storage.local.remove(USER_VOCAB_KEY);
    status.textContent = '已清除';
    return;
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    status.textContent = '请输入非负数字';
    return;
  }
  await chrome.storage.local.set({ [USER_VOCAB_KEY]: Math.round(n) });
  status.textContent = '已保存';
}

async function init(): Promise<void> {
  const state = await send({ type: 'GET_STATE' });
  if (state.type !== 'STATE') {
    status.textContent = '加载失败，请重试';
    return;
  }
  select.innerHTML = '';
  for (const d of state.dictionaries) {
    const opt = document.createElement('option');
    opt.value = d.id;
    opt.textContent = d.name;
    opt.title = d.description;
    select.appendChild(opt);
  }
  select.value = state.activeId;
  select.addEventListener('change', () => void onChange());

  const stored = await chrome.storage.local.get(USER_VOCAB_KEY);
  const v = stored[USER_VOCAB_KEY];
  if (typeof v === 'number' && v > 0) vocabInput.value = String(v);
  vocabInput.addEventListener('change', () => void onVocabChange());
}

void init();
