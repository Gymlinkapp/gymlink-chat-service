import express from 'express';
import { Server } from 'socket.io';
import http from 'http';
import cors from 'cors';
import { Chat, PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const app = express();
app.use(express.json({ limit: '200mb' }));
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

io.on('connection', (socket) => {
  console.log('a user connected: ', socket.id);

  socket.on('join-chat', async (data: any) => {
    socket.join(data.roomName);

    const messages = await prisma.chat.findUnique({
      where: {
        id: data.roomId,
      },
      select: {
        messages: {
          select: {
            createdAt: true,
            content: true,
            sender: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
              },
            },
          },
        },
      },
    });
    // when a user joins the chat it should emit the latest 50 messages and use the createdDate to show them in newest to latest
    if (messages && messages.messages.length > 50) {
      const sortedMessages = messages.messages.sort(
        (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
      );
      socket.emit(
        'messages',
        [...sortedMessages].slice(Math.max(sortedMessages.length - 50, 0))
      );
    } else {
      socket.emit('messages', messages?.messages);
    }

    socket.on('leave-chat', (data: Chat) => {
      console.log('leave-chat: ', data);
      socket.leave(data.id);
      socket.to(data.id).emit('leave-chat', data);
    });
  });

  // listen to a chat-messge
  socket.on('chat-message', async (data) => {
    const chat = await prisma.chat.update({
      where: {
        id: data.roomId,
      },
      data: {
        messages: {
          create: {
            content: data.content,
            sender: {
              connect: {
                id: data.sender.id,
              },
            },
          },
        },
      },
      select: {
        messages: {
          select: {
            content: true,
            id: true,
            sender: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
              },
            },
          },
        },
      },
    });

    // gets the last message
    const message = chat.messages[chat.messages.length - 1];
    socket.to(data.roomName).emit('recieve-message', message);
  });

  // add functionality to listen for typing
  socket.on('typing', (data) => {
    const { isTyping, roomName }: { isTyping: boolean; roomName: string } =
      data;
    console.log('typing: ', data);
    socket.broadcast.to(roomName).emit('typing', isTyping);
  });

  socket.on('disconnect', () => {
    console.log('user disconnected');
  });
});

server.listen(process.env.PORT || 3001, () => {
  console.log('Server started on port 3000');
});
