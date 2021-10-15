prod = False
code = []

import re
def findBytes(line):
    matches = re.finditer(r"0x([\dA-Fa-f]{2})", line)
    return ''.join([match.group(1).upper() for _, match in enumerate(matches)])

with open('dbg_v13_ws.c', 'r') as wsFile:
    msg = None
    codeIndex = -1
    for line in wsFile:
        # 0 == in, 1 == out
        if line.startswith("char"):
            matches = re.search(r"peer([\d]+)_([\d]+)", line)
            id = int(matches.group(1))
            code.append("{} ".format(["in", "out"][id]))
            codeIndex += 1
        else:
            code[codeIndex] += findBytes(line)
        
with open('output_abc.txt', 'w') as out:
    out.write('\n'.join(code))
