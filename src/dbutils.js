const path = require('path');
const { Level } = require('level');
const vscode = require('vscode');
const fs = require('fs');

let db;
const dbpath = path.join(vscode.workspace.rootPath, 'tagsdb')

function initDB() {
  if (!db) {
    db = new Level(dbpath, { valueEncoding: 'json' });
  }
  return db;
}

function getDB() {
  if (!db) throw new Error('DB is not initialized.');
  return db;
}

function closeDB() {
  if (!db) throw new Error('DB is not initialized.');
  db.close();
}

async function getValueFromDb(key) {
  try {
    const value = await db.get(key);
    return value;
  } catch (err) {
    if (err.notFound) {
      return null;
    } else {
      throw err;
    }
  }
}

async function getEntriesWithPrefix(prefix, limit = 10) {
  const entries = [];
  const iterator = db.iterator({
    gte: prefix,
    lte: prefix + '\xff',
    keyEncoding: 'utf8',
    valueEncoding: 'json'
  });

  try {
    for await (const [key, value] of iterator) {
      entries.push({ key, value });
      if (entries.length >= limit) break;
    }
  } catch (err) {
    console.error('Iterator error:', err);
    throw err;
  } finally {
    await iterator.close();
  }
  return entries;
}

async function batchWriteIntoDB(data) {
  try {
    await db.batch(data);
  } catch (err) {
    console.error('Batch write failed:', err);
  }
}

const tokenize = (name) => {
  return name
    .replace(/\.[a-zA-Z0-9]+$/, '')         // remove trailing file extensions like .c, .h, .cpp
    .replace(/([a-z])([A-Z])/g, '$1 $2')    // camelCase → split
    .replace(/[_\-\.\/]+/g, ' ')            // snake_case, kebab-case, dot-separated, paths
    .replace(/[^a-zA-Z0-9 ]/g, '')          // remove other symbols
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
};

const searchQuery = async (query) => {
  const terms = tokenize(query);
  if (terms.length === 0) return [];
  if(terms.length === 2)  {
    console.log();
  }
  const idSets = [];

  for (const term of terms) {
    const ids = new Set();

    for await (const [key, value] of db.iterator({ gte: `token:${term}`, lt: `token:${term}~` })) {
      if (Array.isArray(value)) {
        for (const id of value) {
          if (typeof id === 'number' && Number.isInteger(id)) {
            ids.add(id);
          }
        }
      }
      if (ids.size >= 1000) break;
    }

    if (!ids.size) return []; // no match for one term → no result
    idSets.push(ids);
  }

  // Perform set intersection manually
  let intersection = idSets[0];
  for (let i = 1; i < idSets.length; i++) {
    intersection = new Set([...intersection].filter(id => idSets[i].has(id)));
    if (!intersection.size) return []; // short-circuit if nothing left
  }

  // Fetch matching variables
  const results = [];
  for (const id of intersection) {
    if (results.length >= 10) break;
    try {
      const variableName = await db.get(`id:${id}`);
      const meta = await db.get(`tag:${variableName}`);
      results.push({
        label: variableName,
        description: meta?.file || ''
      });
    } catch {
      // skip invalid entries
    }
  }

  return results;
};


const assignIdsToVariables = async () => {
  let idCounter = 1;
  const tokenMap = new Map();
  const batch = db.batch();

  for await (const [key, value] of db.iterator({ gte: 'tag:', lt: 'tag;' })) {
    const variableName = key.slice(4);
    const newId = idCounter++;

    // batch.put(key, { id: newId, value: value.value });
    batch.put(`id:${newId}`, variableName);

    for (const token of tokenize(variableName)) {
      if (!tokenMap.has(token)) tokenMap.set(token, new Set());
      tokenMap.get(token).add(newId);
    }
  }

  for (const [token, ids] of tokenMap) {
    batch.put(`token:${token}`, Array.from(ids));
  }

  batch.put('id:counter', idCounter - 1);

  await batch.write();
  console.log(`✅ Assigned IDs to ${idCounter - 1} variables and built token index.`);
};

const saveJson = (filename, data) => {
  const json = JSON.stringify(data, null, 2);

  fs.writeFile(filename, json, 'utf8', (err) => {
    if (err) {
      console.error('❌ Failed to write JSON:', err);
    } else {
      console.log(`✅ Saved to ${filename}`);
    }
  });
};

const exportVariablesToJson = async (outputPath) => {
  const results = [];

  for await (const [key, value] of db.iterator()) {
    results.push({ key, value });
  }

  saveJson(outputPath, JSON.stringify(results, null, 2));

  console.log(`✅ Exported ${results.length} variables to ${outputPath}`);
};

module.exports = { initDB, getDB, closeDB, getValueFromDb, getEntriesWithPrefix, batchWriteIntoDB, searchQuery, assignIdsToVariables, exportVariablesToJson };
