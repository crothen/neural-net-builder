const fs = require('fs');
const path = require('path');

const conceptsDir = path.join(__dirname, 'concepts'); // Assumes script is run from project root
const trainingDataPath = path.join(conceptsDir, 'training_data_short.csv');
const outputPath = path.join(conceptsDir, 'training_data_short_readable.csv');

function loadConcept(filename) {
    const content = fs.readFileSync(path.join(conceptsDir, filename), 'utf-8');
    const map = new Map();
    content.split('\n').forEach(line => {
        const [id, word] = line.trim().split(',');
        if (id && word && id !== 'ID') {
            map.set(id.trim(), word.trim());
        }
    });
    return map;
}

const colorMap = loadConcept('color_short.csv');
const shapeMap = loadConcept('shape_short.csv');
const textureMap = loadConcept('texture_short.csv');

const trainingData = fs.readFileSync(trainingDataPath, 'utf-8');
const lines = trainingData.split('\n');
const header = lines[0];
const outputLines = [header];

for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Split handling quoted CSVs or simple split if no quotes (assuming simple for now based on files)
    const [id, word, colorIds, shapeIds, textureIds] = line.split(',');

    const mapIdsToWords = (idsStr, map) => {
        if (!idsStr) return '';
        return idsStr.split(';').map(id => map.get(id.trim()) || `[${id}]`).join('; ');
    };

    const colorWords = mapIdsToWords(colorIds, colorMap);
    const shapeWords = mapIdsToWords(shapeIds, shapeMap);
    const textureWords = mapIdsToWords(textureIds, textureMap);

    outputLines.push(`${id},${word},"${colorWords}","${shapeWords}","${textureWords}"`);
}

fs.writeFileSync(outputPath, outputLines.join('\n'));
console.log('Created human-readable training data at:', outputPath);
