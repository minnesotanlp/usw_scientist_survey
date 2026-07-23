import { deepClone } from "./survey-core.js";

const STORAGE_KEY = "usw_scientist_survey_v2_responses";
const ACTIVE_KEY = "usw_scientist_survey_v2_active_key";
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function randomRecoveryKey() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  const body = Array.from(bytes, (byte) => ALPHABET[byte % ALPHABET.length]).join("");
  return `USW-${body.match(/.{1,4}/g).join("-")}`;
}

async function digest(value) {
  const bytes = new TextEncoder().encode(value.trim().toUpperCase());
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function readDatabase() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") || {};
  } catch {
    return {};
  }
}

function writeDatabase(database) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(database));
}

export class LocalSurveyStore {
  mode = "local";

  async createKey() {
    return randomRecoveryKey();
  }

  setActiveKey(key) {
    sessionStorage.setItem(ACTIVE_KEY, key);
  }

  getActiveKey() {
    return sessionStorage.getItem(ACTIVE_KEY) || "";
  }

  clearActiveKey() {
    sessionStorage.removeItem(ACTIVE_KEY);
  }

  async saveDraft(key, payload) {
    const keyHash = await digest(key);
    const database = readDatabase();
    const existing = database[keyHash];
    const now = new Date().toISOString();
    const record = {
      ...deepClone(payload),
      status: existing?.record?.status === "submitted" ? "editing" : payload.status || existing?.record?.status || "draft",
      version: existing?.record?.version || payload.version || 0,
      createdAt: existing?.record?.createdAt || payload.createdAt || now,
      updatedAt: now,
    };
    database[keyHash] = {
      record,
      revisions: existing?.revisions || [],
    };
    writeDatabase(database);
    this.setActiveKey(key);
    return deepClone(database[keyHash]);
  }

  async submit(key, payload) {
    const keyHash = await digest(key);
    const database = readDatabase();
    const existing = database[keyHash];
    const now = new Date().toISOString();
    const revisions = existing?.revisions || [];
    if (existing?.record?.status === "submitted" || existing?.record?.version > 0) {
      revisions.push(deepClone(existing.record));
    }
    const version = (existing?.record?.version || 0) + 1;
    const record = {
      ...deepClone(payload),
      status: "submitted",
      version,
      createdAt: existing?.record?.createdAt || payload.createdAt || now,
      submittedAt: now,
      updatedAt: now,
    };
    database[keyHash] = { record, revisions };
    writeDatabase(database);
    this.setActiveKey(key);
    return deepClone(database[keyHash]);
  }

  async load(key) {
    const keyHash = await digest(key);
    const entry = readDatabase()[keyHash];
    return entry ? deepClone(entry) : null;
  }
}

export const surveyStore = new LocalSurveyStore();
