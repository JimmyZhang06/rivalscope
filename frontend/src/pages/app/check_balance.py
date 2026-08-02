import re

with open('ProfileDetailPage.tsx', 'r', encoding='utf-8') as f:
    lines = f.readlines()

total = {}
for ch in ['{', '}', '(', ')', '[', ']', '<', '>']:
    total[ch] = sum(line.count(ch) for line in lines)

print('=== Raw character counts ===')
for ch, count in total.items():
    print(f'  {ch}: {count}')

pairs = [('{', '}'), ('(', ')'), ('[', ']')]
print()
print('=== Balance check ===')
for open_ch, close_ch in pairs:
    diff = total[open_ch] - total[close_ch]
    status = 'BALANCED' if diff == 0 else f'UNBALANCED (diff={diff})'
    print(f'  {open_ch} vs {close_ch}: {status}')

print()
print('=== JSX tag balance ===')
all_text = ''.join(lines)
open_tags = re.findall(r'<([A-Z][a-zA-Z]*)\b', all_text)
close_tags = re.findall(r'</([A-Z][a-zA-Z]*)>', all_text)
from collections import Counter
open_count = Counter(open_tags)
close_count = Counter(close_tags)
all_tags = set(list(open_count.keys()) + list(close_count.keys()))
for tag in sorted(all_tags):
    o = open_count.get(tag, 0)
    c = close_count.get(tag, 0)
    if o != c:
        print(f'  UNMATCHED: <{tag}> opened {o} times, </{tag}> closed {c} times')

print()
print('=== Common HTML-like JSX tag balance ===')
for tag in ['div', 'span', 'p', 'ul', 'li', 'h1', 'h2', 'h3', 'button', 'a', 'section', 'nav']:
    open_cnt = len(re.findall(rf'<{tag}\b[^/]*(?<!/)>', all_text))
    close_cnt = len(re.findall(rf'</{tag}>', all_text))
    if open_cnt != close_cnt:
        print(f'  UNMATCHED <{tag}>: opened {open_cnt}, closed {close_cnt}')

print()
print('=== Specific area: Lines 518-534 (ReportView) ===')
for i in range(517, 534):
    print(f'  {i+1}: {lines[i].rstrip()}')

print()
print('=== Specific area: Lines 603-624 (StepTimeline) ===')
for i in range(602, 624):
    print(f'  {i+1}: {lines[i].rstrip()}')

print()
print('=== Brace depth per line (whole file) ===')
depth = 0
issues = []
for i, line in enumerate(lines, 1):
    d = line.count('{') - line.count('}')
    depth += d
    if d != 0:
        print(f'  {i}: delta={d:+d} depth={depth}  {line.rstrip()[:90]}')
    if depth < 0:
        issues.append(f'Line {i}: depth went negative ({depth})')

print()
print(f'Final depth: {depth}')
if issues:
    for iss in issues:
        print(f'  ISSUE: {iss}')
