import re

with open('ProfileDetailPage.tsx', 'r', encoding='utf-8') as f:
    lines = f.readlines()

# Function to count effective braces, properly handling template literals and strings
def count_braces_in_line(line):
    """Count { and } that are NOT inside template literal expressions (i.e. not inside ${...})"""
    # We need to track: are we inside a template literal? Inside ${}?
    i = 0
    in_template = False
    in_substitution = False
    in_string = False
    string_char = None
    escape = False
    
    opens = 0
    closes = 0
    
    while i < len(line):
        ch = line[i]
        
        if escape:
            escape = False
            i += 1
            continue
        
        if ch == '\':
            escape = True
            i += 1
            continue
        
        if in_string:
            if ch == string_char:
                in_string = False
            i += 1
            continue
        
        if ch in ('"', "'"):
            in_string = True
            string_char = ch
            i += 1
            continue
        
        if ch == '`':
            in_template = not in_template
            if in_template:
                in_substitution = False
            i += 1
            continue
        
        if in_template:
            if ch == '$' and i + 1 < len(line) and line[i+1] == '{':
                in_substitution = True
                i += 2
                continue
            if ch == '}':
                # Check if this closes a substitution
                # We need to count substitution depth
                i += 1
                # This is complex - let's use a different approach
                continue
        
        if ch == '{' and (not in_template or in_substitution):
            opens += 1
        elif ch == '}' and (not in_template or in_substitution):
            closes += 1
        
        i += 1
    
    return opens, closes

# Better approach: track brace depth with proper template literal awareness
print("=== Detailed brace depth tracking (template-literal aware) ===\n")
depth = 0
in_template = False
template_depth = 0  # depth inside ${...}
in_dq_string = False
in_sq_string = False
in_template_str = False  # in backtick string
escape = False

issues = []
lines_with_changes = []

for i, line in enumerate(lines, 1):
    j = 0
    line_opens = 0
    line_closes = 0
    
    while j < len(line):
        ch = line[j]
        
        if escape:
            escape = False
            j += 1
            continue
        
        if ch == '\':
            escape = True
            j += 1
            continue
        
        # String handling
        if in_dq_string:
            if ch == '"':
                in_dq_string = False
            j += 1
            continue
        if in_sq_string:
            if ch == "'":
                in_sq_string = False
            j += 1
            continue
        if in_template_str:
            if ch == '`':
                in_template_str = False
            elif ch == '$' and j + 1 < len(line) and line[j+1] == '{':
                template_depth += 1
                j += 2
                continue
            elif ch == '}' and template_depth > 0:
                template_depth -= 1
                j += 1
                continue
            j += 1
            continue
        
        # Not in any string
        if ch == '"':
            in_dq_string = True
        elif ch == "'":
            in_sq_string = True
        elif ch == '`':
            in_template_str = True
        elif ch == '{' and template_depth == 0 and not in_dq_string and not in_sq_string:
            depth += 1
            line_opens += 1
        elif ch == '}' and template_depth == 0 and not in_dq_string and not in_sq_string:
            depth -= 1
            line_closes += 1
            if depth < 0:
                issues.append(f"Line {i}: depth went NEGATIVE ({depth}) after }}")
        
        j += 1
    
    if line_opens != 0 or line_closes != 0:
        lines_with_changes.append((i, line_opens, line_closes, depth, line.rstrip()))

print("Lines with non-zero brace changes:")
for ln, o, c, d, txt in lines_with_changes:
    print(f"  {ln}: {o:+d}/{c:+d} depth={d}  | {txt[:85]}")

print(f"\nFinal brace depth: {depth}")
print(f"Total { vs }: diff = {depth}")

if depth > 0:
    print(f"\n*** Found {depth} unclosed brace(s)! Depth ended at {depth} ***")
    # Find where depth first reached its maximum (likely where the unclosed brace is)
    # Find lines where depth equals the final depth value after processing
    pass
elif depth < 0:
    print(f"\n*** Found {-depth} extra closing brace(s)! ***")
else:
    print("\nBraces are balanced!")

if issues:
    print("\nISSUES:")
    for iss in issues:
        print(f"  {iss}")
