const fs = require('fs');
const content = fs.readFileSync('ProfileDetailPage.tsx', 'utf8');
const lines = content.split('\n');

let depth = 0;
let inStr = false;
let strEnd = '';
let inTpl = false;
let inTplExpr = false;
let tplExprDepth = 0;

for (let i = 0; i < content.length; i++) {
  const c = content[i];

  // Inside regular string or template literal text
  if (inStr && !inTplExpr) {
    if (c === '\\') { i++; continue; }
    if (c === strEnd) {
      if (inTpl) { inTpl = false; }
      inStr = false;
      strEnd = '';
    }
    continue;
  }

  // Inside template expression ${ ... }
  if (inTplExpr) {
    if (c === '{') tplExprDepth++;
    else if (c === '}') {
      tplExprDepth--;
      if (tplExprDepth === 0) {
        inTplExpr = false;
        // Back to template literal text mode
        inStr = true;
        strEnd = '`';
      }
    }
    continue;
  }

  // Not inside any string

  // Template literal start
  if (c === '`') {
    inTpl = true;
    inStr = true;
    strEnd = '`';
    continue;
  }

  // Regular string start
  if (c === '"' || c === "'") {
    inStr = true;
    strEnd = c;
    continue;
  }

  // Template expression start ${
  if (c === '$' && content[i + 1] === '{') {
    inTplExpr = true;
    tplExprDepth = 1; // the { we just found
    i++; // skip the {
    continue;
  }

  // Actual code braces
  if (c === '{') depth++;
  else if (c === '}') depth--;
}

console.log('Final brace depth (should be 0):', depth);

if (depth !== 0) {
  // Find the line of the problematic brace
  let d2 = 0;
  let inStr2 = false, strEnd2 = '', inTpl2 = false, inTplExpr2 = false, tplExprDepth2 = 0;
  let lastNonZeroLine = 0;
  let lastNonZeroDepth = 0;

  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    for (let ci = 0; ci < line.length; ci++) {
      const ch = line[ci];

      if (inStr2 && !inTplExpr2) {
        if (ch === '\\') { ci++; continue; }
        if (ch === strEnd2) {
          if (inTpl2) inTpl2 = false;
          inStr2 = false;
          strEnd2 = '';
        }
        continue;
      }

      if (inTplExpr2) {
        if (ch === '{') tplExprDepth2++;
        else if (ch === '}') {
          tplExprDepth2--;
          if (tplExprDepth2 === 0) {
            inTplExpr2 = false;
            inStr2 = true;
            strEnd2 = '`';
          }
        }
        continue;
      }

      if (ch === '`') { inTpl2 = true; inStr2 = true; strEnd2 = '`'; continue; }
      if (ch === '"' || ch === "'") { inStr2 = true; strEnd2 = ch; continue; }
      if (ch === '$' && line[ci + 1] === '{') {
        inTplExpr2 = true;
        tplExprDepth2 = 1;
        ci++;
        continue;
      }

      if (ch === '{') d2++;
      else if (ch === '}') d2--;
    }

    if (d2 !== 0) {
      lastNonZeroLine = li + 1;
      lastNonZeroDepth = d2;
    }
  }

  console.log('Last line with non-zero depth:', lastNonZeroLine, '(depth:', lastNonZeroDepth, ')');
}
