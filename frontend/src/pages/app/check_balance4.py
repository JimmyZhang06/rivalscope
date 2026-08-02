import re
with open("ProfileDetailPage.tsx", "r", encoding="utf-8") as fin:
    lines = fin.readlines()
depth = 0
template_depth = 0
in_dq = False
in_sq = False
in_tq = False
escape = False
changes = []
for i, line in enumerate(lines, 1):
    j = 0
    o_cnt = 0
    c_cnt = 0
    while j < len(line):
        ch = line[j]
        if escape:
            escape = False
            j += 1
            continue
        if ch == chr(92):
            escape = True
            j += 1
            continue
        if in_dq:
            if ch == chr(34): in_dq = False
            j += 1
            continue
        if in_sq:
            if ch == chr(39): in_sq = False
            j += 1
            continue
        if in_tq:
            if ch == chr(96):
                in_tq = False
            elif ch == chr(36) and j+1 < len(line) and line[j+1] == chr(123):
                template_depth += 1
                j += 2
                continue
            elif ch == chr(125):
                if template_depth > 0:
                    template_depth -= 1
                j += 1
                continue
            j += 1
            continue
        if ch == chr(34): in_dq = True
        elif ch == chr(39): in_sq = True
        elif ch == chr(96): in_tq = True
        elif ch == chr(123):
            depth += 1
            o_cnt += 1
        elif ch == chr(125):
            depth -= 1
            c_cnt += 1
            if depth < 0:
                pass  # will report below
        j += 1
    if o_cnt != 0 or c_cnt != 0:
        changes.append((i, o_cnt, c_cnt, depth))
print("Final brace depth: %d" % depth)
if depth != 0:
    print("*** BRACE IMBALANCE: %d unclosed ***" % depth)
    print("Lines with non-zero delta (last 40):")
    for item in changes[-40:]:
        print("  %d: +%d/-%d depth=%d" % item)
else:
    print("Balanced!")
