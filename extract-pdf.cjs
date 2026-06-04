const { PDFParse } = require('pdf-parse');
const fs = require('fs');
const buf = fs.readFileSync('C:/Users/48604/Downloads/cke-zakres-2025.pdf');
const parser = new PDFParse();
parser.parse(buf).then(data => {
  const text = data.pages.map(p => p.lines.map(l => l.text).join('\n')).join('\n\n');
  console.log(text);
}).catch(e => {
  console.error(e.message);
  // fallback: dump raw structure
  console.log(JSON.stringify(data, null, 2).substring(0, 4000));
});
