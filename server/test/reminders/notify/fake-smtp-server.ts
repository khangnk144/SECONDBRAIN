/**
 * A tiny SMTP server on 127.0.0.1 for tests (no TLS): greets, offers AUTH PLAIN/LOGIN, refuses
 * every login when `acceptLogin` is false, and records the DATA of accepted messages. Enough for
 * nodemailer's real SMTP client to be exercised without any network.
 */
import net from 'node:net';

export interface FakeSmtpServer {
  port: number;
  messages: string[];
  /** Raw lines received (AUTH lines included), for secret scans. */
  lines: string[];
  close(): Promise<void>;
}

export async function startFakeSmtpServer(options: {
  acceptLogin: boolean;
}): Promise<FakeSmtpServer> {
  const messages: string[] = [];
  const lines: string[] = [];
  const sockets = new Set<net.Socket>();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.setEncoding('utf8');
    let buffer = '';
    let inData = false;
    let data = '';
    let authStep = 0;
    const reply = (text: string) => socket.write(`${text}\r\n`);
    reply('220 fake.local ESMTP');
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      let index: number;
      while ((index = buffer.indexOf('\r\n')) >= 0) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        lines.push(line);
        if (inData) {
          if (line === '.') {
            inData = false;
            messages.push(data);
            data = '';
            reply('250 OK queued');
          } else data += `${line}\n`;
          continue;
        }
        if (authStep > 0) {
          authStep -= 1;
          if (authStep === 0) reply(options.acceptLogin ? '235 OK' : '535 5.7.8 Bad credentials');
          else reply('334 UGFzc3dvcmQ6');
          continue;
        }
        const verb = line.split(' ')[0]?.toUpperCase();
        if (verb === 'EHLO') reply('250-fake.local\r\n250 AUTH PLAIN LOGIN');
        else if (verb === 'HELO') reply('250 fake.local');
        else if (verb === 'AUTH') {
          const parts = line.split(' ');
          if (parts[1]?.toUpperCase() === 'PLAIN' && parts[2]) {
            reply(options.acceptLogin ? '235 OK' : '535 5.7.8 Bad credentials');
          } else if (parts[1]?.toUpperCase() === 'LOGIN') {
            authStep = 2;
            reply('334 VXNlcm5hbWU6');
          } else {
            authStep = 1;
            reply('334 ');
          }
        } else if (verb === 'MAIL' || verb === 'RCPT' || verb === 'RSET' || verb === 'NOOP')
          reply('250 OK');
        else if (verb === 'DATA') {
          inData = true;
          reply('354 go ahead');
        } else if (verb === 'QUIT') {
          reply('221 bye');
          socket.end();
        } else reply('502 not implemented');
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as net.AddressInfo).port;
  return {
    port,
    messages,
    lines,
    close: () =>
      new Promise((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
}
