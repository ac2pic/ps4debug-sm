// This will naively match input and send output
// 
const net = require('net');
const fs = require('fs');
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

const lines = fs.readFileSync('ps4debug_1.1.13.txt', 'utf8').split('\n')
                    .map(e => e.trim())
                    .map((line) => {
                        const [_type, msg] = line.split(" ");
                        const out = {
                            "type": _type, 
                            buffer: hexToBuffer(msg)
                        };
                        return out;
                    });
const server = net.createServer((socket) => {
    console.log('New socket connection!');
    let lineIndex = 0;
    let inMatched = 0;
    socket.on('data', function(buffer) {
        const line = lines[lineIndex];
        if (line.type === 'in') {
            if (inMatched < line.buffer.length) {
                for(let i = 0; i < line.buffer.length; i++) {
                    if (buffer[i] != line.buffer[inMatched + i]) {
                        console.error(`Mismatch at ${lineIndex + 1}:${inMatched + i + 4}`);
                        socket.close();
                    }
                }
            }
            if (inMatched === line.buffer.length) {
                inMatched = 0;
                lineIndex++;
                socket.write(line.buffer);
                lineIndex++;
            }
        }
    });
}).on('error', (err) => {
    // Handle errors here.
    // throw err;
});

server.listen(744, 'localhost', 511, () => {
    console.log('opened server on', server.address());
});
console.log('Started listening');

process.on('uncaughtException',function(err){
    if (err.code === 'ECONNRESET') {
        // ignore this
    } else {
        console.log('something terrible happened..');
        console.log(err);
        process.exit(-1);
    }
});
