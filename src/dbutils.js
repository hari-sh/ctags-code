const path = require('path');
const vscode = require('vscode');
const nodeGypBuild = require('node-gyp-build');

function customNodeGypBuild() {
  const prebuildsPath = path.join(__dirname, 'prebuilds');
  return nodeGypBuild(prebuildsPath);
}

const Module = require('module');
const originalRequire = Module.prototype.require;

Module.prototype.require = function (id) {
  if (id === 'node-gyp-build') {
    return customNodeGypBuild;
  }
  return originalRequire.apply(this, arguments);
};

const { ClassicLevel } = require('classic-level');
const fs = require('fs');

let db;
const dbpath = path.join(vscode.workspace.rootPath, 'tagsdb');
let inputUnionMap = new Map();

function resetSearchMap()  {
  inputUnionMap = new Map();
}

function initDB() {
  if (!db) {
    db = new ClassicLevel(dbpath, { valueEncoding: 'json' });
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

function getUnion(group) {
  const union = new Set();
  for (const arr of group) {
    for (const val of arr) {
      union.add(val);
    }
  }
  return union;
}

function intersectionOfUnions(unionSets, limit = 10) {
  const [firstSet, ...restSets] = unionSets;
  const result = [];
  for (const val of firstSet) {
    if (restSets.every(set => set.has(val))) {
      result.push(val);
      if (result.length === limit) break;
    }
  }
  return result;
}

async function getIds(words) {
  const unionSets = [];
  for (const word of words) {
    let unionSet;
    if (inputUnionMap.has(word)) {
      unionSet = inputUnionMap.get(word);
      console.log(inputUnionMap);
    } else {
      const ilist = [];
      for await (const [key, value] of db.iterator({ gte: `token:${word}`, lt: `token:${word}~` })) {
        ilist.push(value);
      }
      unionSet = getUnion(ilist);
      inputUnionMap.set(word, unionSet);
    }
    unionSets.push(unionSet);
  }
  return intersectionOfUnions(unionSets);
}


const searchQuery = async (query) => {
  const terms = tokenize(query);
  if (terms.length === 0) return [];
  const results = [];
  const ids = await getIds(terms);
  for (const id of ids) {
    try {
      const variableName = await db.get(`id:${id}`);
      const meta = await db.get(`tag:${variableName}`);
      results.push({
        label: variableName,
        description: meta?.file || ''
      });
    } catch {
      console.log('Unable to get db value');
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

module.exports = { initDB, getDB, closeDB, getValueFromDb, batchWriteIntoDB, searchQuery, assignIdsToVariables, resetSearchMap };
