const net = require('net');
const fs = require('fs');


function bufferToString(buffer, encoding) {
    return buffer.subarray(0, buffer.indexOf(0)).toString(encoding);
}

function matchOuts(socket, replay) {
    do {
        let current = replay.peek(0);
        if (!current || current.type !== 'out') {
            break;
        }
        current = replay.matchOut();
        if (current && current.type === 'out') {
            socket.write(hexToBuffer(current.data));
        }
    } while (true);
}


const CMD = {
    // Debug only
    [0x01FF0001]: {
        name: "CMD_PUSH_REPLAY_FILE",
        run: function(socket, cmdArg, {replay}) {
            socket.write(hexToBuffer('00000080'));
            const filePath = bufferToString(cmdArg.subarray(0, 32), 'ascii');
            const index = cmdArg.readUInt32LE(32);
            replay.pushReplayFile(filePath, index);
            socket.write(hexToBuffer('00000080'));
            console.log('Done pushing!');
        }
    },
    [0x01FF0002]: {
        name: "CMD_POP_REPLAY_FILE",
        run: function(socket, _, {replay}) {
            socket.write(hexToBuffer('00000080'));
            if (replay.popReplayFile()) {
                socket.write(hexToBuffer('00000080'));
            } else {
                socket.write(hexToBuffer('010000F0'));
            }
        }
    },
    [0xBD000500]: {
        name: "CMD_FW_VERSION",
        run: function(socket, _, {replay}) {
            matchOuts(socket, replay);
        }
    },
    [0xBD000501]: {
        name: "CMD_PS4DEBUG_EXT_VERSION",
        run: function(socket, _, {replay}) {
            matchOuts(socket, replay);
        }
    },
    [0xBD000001]: {
        name: "CMD_PS4DEBUG_BASE_VERSION",
        run: function(socket, _, {replay}) {
            replay.matchOut();
            socket.write(hexToBuffer('03000000'));
            replay.matchOut();
            socket.write(hexToBuffer('312E33'));
        }
    },
    // regular
    [0xBDAA0001]: {
        name: "CMD_PROC_LIST",
        run: function(socket, _, {replay}) {
            matchOuts(socket, replay);
        }
    },
    [0xBDAA0002]: {
        name: "CMD_PROC_READ",
        run: async function (socket, _, {replay}) {
            matchOuts(socket, replay);
        }
    },
    [0xBDAA0003]: {
        name: "CMD_PROC_WRITE",
        run: async function (socket, argBuffer, {read,replay}) {
            matchOuts(socket, replay);

            const length = argBuffer.readUInt32LE(12);
            const cmdWrite = await read(length);
            replay.matchIn(cmdWrite);
            matchOuts(socket, replay);
        }
    },
    [0xBDAA0004]: {
        name: "CMD_PROC_MAPS",
        run: function(socket, argBuffer, {self, replay}) {
            matchOuts(socket, replay);
        }
    },
    [0xBDAA0005]: {
        name: "CMD_PROC_INSTALL",
        run: function(socket, argBuffer, {replay}) {
            matchOuts(socket, replay);
        }
    },
    [0xBDAA0006]: {
        name: "CMD_PROC_CALL",
        run: function(socket, _, {replay}) {
            let out = replay.matchOut();
            socket.write(hexToBuffer(out.data));

            // send return code
            out = replay.matchOut();
            socket.write(hexToBuffer(out.data));
        }
    },
    [0xBDAA000B]: { 
        name: "CMD_PROC_ALLOC",
        run: function(socket, argBuffer, {replay}) {
            matchOuts(socket, replay);
        }
    },
    [0xBDAA000C]: {
        name: "CMD_PROC_FREE",
        run: function(socket, argBuffer, {replay}) {
            matchOuts(socket, replay);
        }
    },
};

function parseReplayLine(line) {
    line = line.trim();
    let match = line.match(/\w+/);

    if (!match) {
        throw Error(`Must have type.`);
    }
    const type = match[0];
    let index = 2;
    
    line = line.substring(type.length);
    
    index += type.length;

    const args = [];
    while (line.length) {
        match = line.match(/\s*0x([A-F0-9]+)/);
        if (!match) {
            throw {char: index, message: 'Unexpected character!'};
        }

        args.push(match[1]);
        line = line.substring(match[0].length);
        index += match[0].length;
    }

    return {
        type,
        args
    }
}


function processLines(lines) {
    const processed = [];
    let lineIndex = 0;
    for (let line of lines) {
        let numberMatch = line.match(/^(\d+):/); 
        if (!numberMatch) {
            continue;
        }
        line = line.substring(numberMatch[0].length);
        if (!line.startsWith('(')) {
            continue;
        }

        if (!line.endsWith(')')) {
            throw Error(`${lineIndex}: Missing closing parenthesis! `);
        }

        let replayValue;
        try {
            replayValue = parseReplayLine(line.substring(1, line.length - 1));
        } catch (e) {
            throw Error(`${lineIndex}@${e.char}: ${e.message}`); 
        }
        processed.push(replayValue);
        lineIndex++;
    }
    return processed;
}


function createReplayList(lines) {
    const prosLines = processLines(lines);

    const list = [];
    for (const prosLine of prosLines) {
        const line = {
            type: prosLine.type,
        };
        list.push(line);
        switch(prosLine.type) {
            case 'cmd': {
                line.name = prosLine.args[0];
                line.argLength = prosLine.args[1];
                break;
            }
            case 'in':
            case 'out': {
                line.data = prosLine.args[0];
                break;
            }
            default:
                break;
        }
    }

    return list;
}

const cacheReplayFiles = {

};

function Replay() {
    let replayStack = [];
    let currentReplay = null;
    function getCurrentItem() {
        if (currentReplay == null) {
            throw 'currentReplay is null!';
        }
        const {arr, index} = currentReplay;
        return arr[index];

    }

    function peek(offset) {
        const {arr, index} = currentReplay;
        return arr[index + offset];
    }
    function increaseIndex() {
        currentReplay.index++;
    }
    function reset() {
        currentReplay.index = 0;
    }

    function matchOut() {
        const out = getCurrentItem();
        if (out.type !== 'out') {
            throw Error(`At @${currentReplay.index}: Expected <out> but got <${out.type}>.`);
        }
        increaseIndex();
        return out;
    }

    function matchIn(buffer) {
        let data = bufferToHex(buffer);
        const ins = getCurrentItem();
        if (ins.type !== 'in') {
            throw Error(`At @${currentReplay.index}: Expected <in> but got <${ins.type}>.`);
        }

        if (ins.data !== data) {
            throw Error(`At @${currentReplay.index}: ${ins.data} does not match ${data}.`);
        }
        increaseIndex();
        return ins;
    }


    function matchCommand(buffer) {
        const cmd = getCurrentItem();
        if (cmd.type !== 'cmd') {
            throw Error(`At @${currentReplay.index}: Expected <cmd> but got <${cmd.type}>.`);
        }

        const name = bufferToHex(buffer.subarray(0, 4));
        const argLength = bufferToHex(buffer.subarray(4));

        if (cmd.name !== name) {
            throw Error(`At @${currentReplay.index}: ${name} does not match ${cmd.name}.`);
        }


        if (cmd.argLength !== argLength) {
            throw Error(`At @${currentReplay.index}: ${argLength} does not match ${cmd.argLength}.`);
        }

        increaseIndex();
        return cmd;
    }

    function pushReplayFile(filePath, newIndex) {
        let replayArr = cacheReplayFiles[filePath];
        if (!cacheReplayFiles[filePath]) {
            const lines = fs.readFileSync(filePath, 'utf8').split('\n').map(e => e.trim());
            replayArr = cacheReplayFiles[filePath] = createReplayList(lines);
        }
        if (currentReplay && currentReplay.arr == replayArr) {
            currentReplay.index = newIndex;
        } else {
            currentReplay =  {
                arr: replayArr,
                index: newIndex
            };
            replayStack.push(currentReplay);
        }
    }

    function popReplayFile() {
        let success = false;
        if (replayStack.length > 1) {
            replayStack.pop();
            currentReplay = replayStack[replayStack.length - 1];
            success = true;
        }

        return success;
    }


    return {
        pushReplayFile,
        popReplayFile,
        matchCommand,
        matchIn,
        matchOut,
        reset,
        peek,
    };
}


function bufferToHex(buffer) {
    let str = "";
    if (buffer == null) debugger;
    for(const byte of buffer) {
        str += byte.toString(16).padStart(2, "0").toUpperCase();
    }
    return str;
}

Buffer = Buffer || {
    alloc: (value) => {return new Uint8Array(Array(value).fill(0))}
};

function hexToBuffer(hex) {
    const buffer = Buffer.alloc(hex.length/2);
    let index = 0;
    while (index < hex.length) {
        const hexByte = hex.substring(index, index + 2);
        buffer[index/2] = Number("0x" + hexByte);
        index += 2;
    }
    return buffer;
}

const PACKET_MAGIC = 0xFFAABBCC;
// CacheReplay('output.txt');

const server = net.createServer((socket) => {
    console.log('New socket connection!');
    const replay = Replay();
    replay.pushReplayFile('out_123.txt', 0);

    const data = [];

    function onData(buffer) {
        data.push(...buffer);
    }

    function closeConnection() {
        clearTimeout(readTimeoutId);
        clearTimeout(cmdLoopTimeoutId);
        socket.end();
    }

    let readTimeoutId = -1;
    async function read(byteLength) {
        return new Promise((resolve, _) => {
            const checkData = () => {
                if (data.length >= byteLength) {
                    const dataSlice = data.splice(0, byteLength);
                    resolve(Buffer.from(dataSlice));
                } else {
                    readTimeoutId = setImmediate(checkData); 
                }
            };
            readTimeoutId = setImmediate(checkData);
        });
    }

    socket.on('data', onData);
    async function checkForCmd() {
        const cmdPacket = await read(12);
        if (cmdPacket.readUInt32LE(0) != PACKET_MAGIC) {
            sendStatus(socket, CMD_ERROR);
        }

        const cmdNumber = cmdPacket.readUInt32LE(4);
        const cmd = CMD[cmdNumber];
        if (!cmd) {
            console.log('Trying to execute', cmdNumber.toString(16));
            sendStatus(socket, CMD_ERROR);
            return; 
        }
        console.log('CMD ', cmd.name);
        let isDebug = (cmdNumber & 0x7fFF0000) == 0x1ff0000;

        const cmdArgLength = cmdPacket.readUInt32LE(8);
        let cmdArg = null;

        if (!isDebug) {
            replay.matchCommand(cmdPacket.subarray(4));
        }

        if (cmdArgLength > 0) {
            cmdArg = await read(cmdArgLength);
        }

        if (!isDebug && cmdArg) {
            replay.matchIn(cmdArg);
        }
        await cmd.run(socket, cmdArg, {isDebug, read, replay});
    }

    let cmdLoopTimeoutId = -1;

    const cmdLoop = async () => {
        try {
            await checkForCmd();
        } catch (e) {
            console.log(e);
            closeConnection();
        }
        cmdLoopTimeoutId = setImmediate(cmdLoop); 
    };
    cmdLoopTimeoutId = setImmediate(cmdLoop);


}).on('error', (err) => {
    // Handle errors here.
    // throw err;
});

server.listen(744, 'localhost', 511, () => {
    console.log('opened server on', server.address());
});

process.on('uncaughtException',function(err){
    if (err.code === 'ECONNRESET') {
        // ignore this
    } else {
        console.log('something terrible happened..');
        console.log(err);
        process.exit(-1);
    }
});
