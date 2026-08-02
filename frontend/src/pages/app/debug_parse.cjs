const ts = require('typescript');
const fs = require('fs');

const content = fs.readFileSync('ProfileDetailPage.tsx', 'utf8');
const sourceFile = ts.createSourceFile('test.tsx', content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

function printDiagnostics(node, depth = 0) {
  if (node.kind === ts.SyntaxKind.EndOfFileToken) {
    // Check if parent is still open
    console.log('Reached EOF, checking parent chain...');
    let p = node.parent;
    let chain = [];
    while (p) {
      chain.push(ts.SyntaxKind[p.kind]);
      p = p.parent;
    }
    console.log('Parent chain from EOF:', chain.join(' -> '));
    return;
  }

  // Look for unexpected tokens
  if (node.kind === ts.SyntaxKind.Unknown) {
    console.log('Unknown token at pos', node.getFullStart(), '- parent:', ts.SyntaxKind[node.parent?.kind] || 'none');
    const text = node.getText();
    if (text) console.log('  Text:', JSON.stringify(text));
  }
}

function visit(node) {
  printDiagnostics(node);
  ts.forEachChild(node, visit);
}

visit(sourceFile);

// Also check: is there a missing closing brace?
// Count open braces by looking at the AST
let braceCount = 0;
function countBraces(node) {
  if (node.kind === ts.SyntaxKind.OpenBraceToken) braceCount++;
  if (node.kind === ts.SyntaxKind.CloseBraceToken) braceCount--;
  ts.forEachChild(node, countBraces);
}
countBraces(sourceFile);
console.log('\nBrace balance from AST:', braceCount);

// Check parens too
let parenCount = 0;
function countParens(node) {
  if (node.kind === ts.SyntaxKind.OpenParenToken) parenCount++;
  if (node.kind === ts.SyntaxKind.CloseParenToken) parenCount--;
  ts.forEachChild(node, countParens);
}
countParens(sourceFile);
console.log('Paren balance from AST:', parenCount);
