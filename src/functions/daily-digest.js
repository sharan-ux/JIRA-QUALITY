// src/functions/daily-digest.js — secret-keyed web-trigger returning the daily digest JSON.
import { computeDailyBoard } from '../resolvers/compliance';

export async function handler(req) {
  const key = (req.queryParameters && req.queryParameters.key && req.queryParameters.key[0]) || '';
  if (!process.env.DIGEST_KEY || key !== process.env.DIGEST_KEY) {
    return { statusCode: 401, headers: { 'Content-Type': ['application/json'] }, body: JSON.stringify({ error: 'unauthorized' }) };
  }
  try {
    const date = (req.queryParameters && req.queryParameters.date && req.queryParameters.date[0]) || null;
    const board = await computeDailyBoard(date);   // date (YYYY-MM-DD) re-renders a past day; else today
    return { statusCode: 200, headers: { 'Content-Type': ['application/json'] }, body: JSON.stringify(board) };
  } catch (e) {
    return { statusCode: 500, headers: { 'Content-Type': ['application/json'] }, body: JSON.stringify({ error: String(e && e.message || e) }) };
  }
}
