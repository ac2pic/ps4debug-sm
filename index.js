const net = require('net');
const fs = require('fs');

const CMD = {
    // Debug only
    [0x01FF0001]: {
        name: "CMD_PUSH_REPLAY_FILE",
        run: function(_, cmdArg, {replay}) {
            const filePath = cmdArg.subarray(0, 32).toString('ascii').trim();
            const index = cmdArg.readUInt32LE(32);
            replay.pushReplayFile(filePath, index);
            socket.write(hexToBuffer('00000080'));
        }
    },
    [0x01FF0002]: {
        name: "CMD_POP_REPLAY_FILE",
        run: function(socket, _, {replay}) {
            if (replay.popReplayFile()) {
                socket.write(hexToBuffer('00000080'));
            } else {
                socket.write(hexToBuffer('010000F0'));
            }
        }
    },
    // regular
    [0xBDAA0001]: {
        name: "CMD_PROC_LIST",
        run: function(socket, _, {replay}) {
            // send count
            let out = replay.matchOut();
            socket.write(hexToBuffer(out.data));
            
            // send out data
            out = replay.matchOut();
            socket.write(hexToBuffer(out.data));
        }
    },
    [0xBDAA0002]: {
        name: "CMD_PROC_READ",
        run: async function (socket, _, {replay}) {
            const out = replay.matchOut();
            socket.write(hexToBuffer(out.data));
        }
    },
    [0xBDAA0003]: {
        name: "CMD_PROC_WRITE",
        run: async function (socket, argBuffer, {read,replay}) {
            const length = argBuffer.readUInt32LE(12);
            const cmdWrite = await read(length);
            replay.matchIn(cmdWrite);
            const out = replay.matchOut();
            socket.write(hexToBuffer(out.data));
        }
    },
    [0xBDAA0004]: {
        name: "CMD_PROC_MAPS",
        run: function(socket, argBuffer, {self, replay}) {
            const callKey = bufferToHex(argBuffer);

            // send count
            let out = replay.matchOut();
            socket.write(hexToBuffer(out.data));

            // send data
            out = replay.matchOut();
            socket.write(hexToBuffer(out.data));
        }
    },
    [0xBDAA0005]: {
        name: "CMD_PROC_INSTALL",
        run: function(socket, argBuffer, {replay}) {
            // const pid = argBuffer.readUInt32LE(0);
            // send start thingy
            // send start
            out = replay.matchOut();
            socket.write(hexToBuffer(out.data));  
        }
    },
    [0xBDAA0006]: {
        name: "CMD_PROC_CALL",
        run: function(socket, _, {replay}) {
            // send return code
            let out = replay.matchOut();
            socket.write(hexToBuffer(out.data));
        }
    },
    [0xBDAA000B]: { 
        name: "CMD_PROC_ALLOC",
        run: function(socket, argBuffer, {replay}) {
            const callKey = bufferToHex(argBuffer);
            let out = replay.matchOut();
            socket.write(hexToBuffer(out.data));
        }
    },
    [0xBDAA000C]: {
        name: "CMD_PROC_FREE",
        run: function(socket, argBuffer) {
            // doesn't need to do anything
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
        lineIndex++;
        
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
    let index = 0;
    

    function getCurrentItem() {
        if (currentReplay == null) {
            throw 'currentReplay is null!';
        }
        const {arr, index} = currentReplay;
        return arr[index];

    }

    function increaseIndex() {
        currentReplay.index++;
    }
    function reset() {
        index = 0;
    }

    function matchOut() {
        const out = getCurrentItem();
        if (out.type !== 'out') {
            throw Error(`Expected <out> but got <${out.type}>.`);
        }
        increaseIndex();
        return out;
    }

    function matchIn(buffer) {
        let data = bufferToHex(buffer);
        const ins = getCurrentItem();
        if (ins.type !== 'in') {
            throw Error(`Expected <in> but got <${ins.type}>.`);
        }

        if (ins.data !== data) {
            throw Error(`${ins.data} does not match ${data}.`);
        }
        increaseIndex();
        return ins;
    }


    function matchCommand(buffer) {
        const cmd = getCurrentItem();
        if (cmd.type !== 'cmd') {
            throw Error(`Expected <cmd> but got <${cmd.type}>.`);
        }

        const name = bufferToHex(buffer.subarray(0, 4));
        const argLength = bufferToHex(buffer.subarray(4));

        if (cmd.name !== name) {
            throw Error(`${name} does not match ${cmd.name}.`);
        }


        if (cmd.argLength !== argLength) {
            throw Error(`${argLength} does not match ${cmd.argLength}.`);
        }

        increaseIndex();
        return cmd;
    }

    function pushReplayFile(filePath, newIndex) {
        if (!cacheReplayFiles[filePath]) {
            const lines = fs.readFileSync(filePath, 'utf8').split('\n').map(e => e.trim());
            cacheReplayFiles[filePath] = createReplayList(lines);
        }
        currentReplay =  {
            arr: cacheReplayFiles[filePath],
            index: newIndex
        };
        replayStack.push(currentReplay);
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
        index,
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
    async function execCmd(cmd, bufferArgs, helper) {
        console.log('Executing ', cmd.name);
        if (!helper.isDebug) {
            const out = replay.matchOut();
            socket.write(hexToBuffer(out.data));
        }
        await cmd.run(socket, bufferArgs, helper);        
    }
    const data = [];

    function onData(buffer) {
        data.push(...buffer);
    }

    function closeConnection() {
        clearTimeout(readTimeoutId);
        clearTimeout(cmdLoopTimeoutId);
        socket.close();
    }

    let readTimeoutId = -1;
    async function read(byteLength) {
        return new Promise((resolve, _) => {
            const checkData = () => {
                if (data.length >= byteLength) {
                    const dataSlice = data.splice(0, byteLength);
                    resolve(Buffer.from(dataSlice));
                } else {
                    readTimeoutId = setTimeout(checkData); 
                }
            };
            readTimeoutId = setTimeout(checkData);
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

        await execCmd(cmd, cmdArg, {isDebug, read, replay});
    }

    let cmdLoopTimeoutId = -1;

    const cmdLoop = async () => {
        try {
            await checkForCmd();
        } catch (e) {
            console.log(e);
            closeConnection();
        }
        cmdLoopTimeoutId = setTimeout(cmdLoop); 
    };
    cmdLoopTimeoutId = setTimeout(cmdLoop);


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
