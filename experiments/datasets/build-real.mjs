// Validates a hand-written ("readable") word list against its concept groups and writes the ID form the app and
// the experiment harness load.
//   node experiments/datasets/build-real.mjs [dir=concepts-real]
// Input:
//   <dir>/groups/<Group>.csv      "ID,Word" - one concept per row, IDs 1..n
//   <dir>/words/*.csv             "Word,<Group>,<Group>,..." - cells hold concept LABELS separated by ";".
//                                 Files may list any subset of the groups as columns, in any order.
// Output:
//   <dir>/training-data.csv           "ID,Word,<every group>" with concept IDs separated by ";" (same shape as concepts/training-data.csv)
//   <dir>/training-data.readable.csv  the same with labels
// Exit code 1 if there are errors (unknown labels, duplicate words, malformed rows).
import fs from 'node:fs';
import path from 'node:path';

const dir = path.resolve(process.argv[2] || 'concepts-real');
const parseLine = (line) => {
    const out = []; let cur = '', q = false;
    for (const ch of line) { if (ch === '"') q = !q; else if (ch === ',' && !q) { out.push(cur); cur = ''; } else cur += ch; }
    out.push(cur); return out.map(s => s.trim());
};
const read = (f) => fs.readFileSync(f, 'utf8').split(/\r?\n/).filter(l => l.trim().length).map(parseLine);
const errors = [], warnings = [];

// ---- groups
const groupDir = path.join(dir, 'groups');
const groups = {}; // name -> { labels: [..], byLower: Map(lower -> id) }
for (const file of fs.readdirSync(groupDir).filter(f => f.endsWith('.csv')).sort()) {
    const name = file.replace(/\.csv$/, '');
    if (!/^[A-Z][A-Za-z0-9]*$/.test(name)) errors.push(`group file "${file}": name must be PascalCase letters/digits only`);
    const rows = read(path.join(groupDir, file));
    if (rows[0].join(',') !== 'ID,Word') errors.push(`${file}: header must be "ID,Word"`);
    const g = { labels: [], byLower: new Map() };
    rows.slice(1).forEach((r, i) => {
        if (Number(r[0]) !== i + 1) errors.push(`${file}: row ${i + 2} has ID "${r[0]}", expected ${i + 1}`);
        const label = r[1] || '';
        if (!label) errors.push(`${file}: row ${i + 2} has an empty label`);
        if (/[;,"]/.test(label)) errors.push(`${file}: label "${label}" contains ; , or "`);
        if (g.byLower.has(label.toLowerCase())) errors.push(`${file}: duplicate concept "${label}"`);
        g.byLower.set(label.toLowerCase(), i + 1); g.labels.push(label);
    });
    groups[name] = g;
}
const groupNames = Object.keys(groups);

// ---- words
const wordDir = path.join(dir, 'words');
const words = []; const seen = new Map();
for (const file of fs.existsSync(wordDir) ? fs.readdirSync(wordDir).filter(f => f.endsWith('.csv')).sort() : []) {
    const rows = read(path.join(wordDir, file));
    const header = rows[0];
    if (header[0] !== 'Word') errors.push(`${file}: first column must be "Word"`);
    for (const col of header.slice(1)) if (!groups[col]) errors.push(`${file}: unknown group column "${col}"`);
    rows.slice(1).forEach((r, i) => {
        const where = `${file} row ${i + 2}`;
        if (r.length !== header.length) { errors.push(`${where} ("${r[0]}"): ${r.length} cells, header has ${header.length} (a label with a comma? a missing comma?)`); return; }
        const word = r[0];
        if (!word) { errors.push(`${where}: empty word`); return; }
        if (seen.has(word.toLowerCase())) { errors.push(`${where}: duplicate word "${word}" (also in ${seen.get(word.toLowerCase())})`); return; }
        seen.set(word.toLowerCase(), where);
        const ids = {}; let count = 0;
        header.slice(1).forEach((col, k) => {
            if (!groups[col]) return;
            const list = [];
            for (const label of r[k + 1].split(';').map(s => s.trim()).filter(Boolean)) {
                const id = groups[col].byLower.get(label.toLowerCase());
                if (!id) errors.push(`${where} ("${word}"): "${label}" is not a concept in ${col}`);
                else if (list.includes(id)) warnings.push(`${where} ("${word}"): "${label}" listed twice in ${col}`);
                else list.push(id);
            }
            ids[col] = list.sort((a, b) => a - b); count += list.length;
        });
        words.push({ word, ids, count, file });
    });
}

// ---- checks and statistics
const keyOf = (w) => groupNames.map(g => (w.ids[g] || []).join('.')).join('|');
const byKey = new Map();
for (const w of words) { const k = keyOf(w); if (!byKey.has(k)) byKey.set(k, []); byKey.get(k).push(w.word); }
const identical = [...byKey.values()].filter(v => v.length > 1);
const flat = words.map(w => new Set(groupNames.flatMap(g => (w.ids[g] || []).map(id => `${g}:${id}`))));
const usage = new Map();
flat.forEach(s => s.forEach(c => usage.set(c, (usage.get(c) || 0) + 1)));
const totalConcepts = groupNames.reduce((a, g) => a + groups[g].labels.length, 0);
const unused = groupNames.flatMap(g => groups[g].labels.map((l, i) => (usage.has(`${g}:${i + 1}`) ? null : `${g}:${l}`)).filter(Boolean));
const common = [...usage.entries()].filter(([, n]) => n > words.length * 0.4).map(([c, n]) => { const [g, id] = c.split(':'); return `${g}:${groups[g].labels[id - 1]} (${n})`; });
const thin = words.filter(w => w.count < 6).map(w => `${w.word} (${w.count})`);
// nearest neighbour of each word: how many concepts separate it from its most similar word
const nearest = [];
for (let a = 0; a < flat.length; a++) {
    let best = Infinity, who = -1;
    for (let b = 0; b < flat.length; b++) {
        if (a === b) continue;
        let inter = 0; for (const c of flat[a]) if (flat[b].has(c)) inter++;
        const diff = flat[a].size + flat[b].size - 2 * inter;
        if (diff < best) { best = diff; who = b; }
    }
    nearest.push({ word: words[a].word, other: who >= 0 ? words[who].word : '', diff: best });
}
const tooClose = nearest.filter(n => n.diff > 0 && n.diff < 2).map(n => `${n.word}~${n.other}`);
const counts = words.map(w => w.count).sort((a, b) => a - b);
const groupsPerWord = words.map(w => groupNames.filter(g => (w.ids[g] || []).length).length);
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

console.log(`groups: ${groupNames.length}, concepts: ${totalConcepts} (${groupNames.map(g => `${g} ${groups[g].labels.length}`).join(', ')})`);
console.log(`words: ${words.length} | concepts per word: min ${counts[0] ?? 0}, median ${counts[Math.floor(counts.length / 2)] ?? 0}, max ${counts[counts.length - 1] ?? 0}, mean ${mean(counts).toFixed(1)} | groups used per word: mean ${mean(groupsPerWord).toFixed(1)}`);
console.log(`concepts never used: ${unused.length}${unused.length ? ' -> ' + unused.slice(0, 40).join(', ') + (unused.length > 40 ? ' ...' : '') : ''}`);
console.log(`concepts used by more than 40% of words: ${common.length ? common.join(', ') : 'none'}`);
console.log(`words with fewer than 6 concepts: ${thin.length ? thin.join(', ') : 'none'}`);
console.log(`words with IDENTICAL concept sets (cannot be told apart): ${identical.length ? identical.map(v => v.join(' = ')).join('; ') : 'none'}`);
console.log(`word pairs differing by only 1 concept: ${tooClose.length ? tooClose.slice(0, 40).join(', ') : 'none'}`);
const hist = {}; for (const n of nearest) { const k = n.diff >= 10 ? '10+' : String(n.diff); hist[k] = (hist[k] || 0) + 1; }
console.log(`distance to the most similar word (number of differing concepts -> words): ${Object.entries(hist).sort((a, b) => parseInt(a[0]) - parseInt(b[0])).map(([k, v]) => `${k}:${v}`).join('  ')}`);
for (const w of warnings.slice(0, 30)) console.log('warning: ' + w);
if (errors.length) {
    console.log(`\n${errors.length} ERRORS:`); for (const e of errors.slice(0, 80)) console.log('  ' + e);
    if (errors.length > 80) console.log(`  ... and ${errors.length - 80} more`);
    process.exit(1);
}

// ---- output
const head = ['ID', 'Word', ...groupNames].join(',');
fs.writeFileSync(path.join(dir, 'training-data.csv'), [head, ...words.map((w, i) => [i + 1, w.word, ...groupNames.map(g => (w.ids[g] || []).join(';'))].join(','))].join('\n') + '\n');
fs.writeFileSync(path.join(dir, 'training-data.readable.csv'), [head, ...words.map((w, i) => [i + 1, w.word, ...groupNames.map(g => (w.ids[g] || []).map(id => groups[g].labels[id - 1]).join('; '))].join(','))].join('\n') + '\n');
console.log(`\nOK -> ${path.relative(process.cwd(), path.join(dir, 'training-data.csv'))} and training-data.readable.csv`);
