import sys
prod = False
code = []

import re
def findBytes(line):
    matches = re.finditer(r"0x([\dA-Fa-f]{2})", line)
    return ''.join([match.group(1).upper() for _, match in enumerate(matches)])

with open(sys.argv[1], 'r') as wsFile:
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
for codeIndex in range(len(code)):
    codeLine = code[codeIndex]
    [typeId, hexValue] = codeLine.split(" ")
    code[codeIndex] = "{} {}".format(typeId, hexValue)


with open('out_' + sys.argv[1], 'w') as out:
    out.write('\n'.join(code))
