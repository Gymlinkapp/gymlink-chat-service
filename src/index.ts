import express from 'express';
import { Server, Socket } from 'socket.io';
import http from 'http';
import cors from 'cors';
import { Chat, PrismaClient } from '@prisma/client';

interface JoinChatData {
  roomName: string;
  roomId: string;
  initialMessage?: string;
  sender: {
    id: string;
    firstName: string;
    lastName: string;
  };
}

interface ChatMessageData {
  createdAt: Date;
  roomName: string;
  roomId: string;
  sender: {
    id: string;
    firstName: string;
    lastName: string;
  };
  content: string;
}

interface TypingData {
  isTyping: boolean;
  roomName: string;
}

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

async function fetchAndEmitMessages(
  roomId: string,
  socket: Socket,
  initialMessage?: ChatMessageData | null
) {
  if (initialMessage) {
    await prisma.chat.update({
      where: {
        id: roomId,
      },
      data: {
        messages: {
          create: {
            content: initialMessage.content,
            sender: {
              connect: {
                id: initialMessage.sender.id,
              },
            },
          },
        },
      },
    });
  }
  const messages = await prisma.chat.findUnique({
    where: {
      id: roomId,
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

  let allMessages = messages?.messages || [];

  if (allMessages.length > 50) {
    const sortedMessages = allMessages.sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
    );
    socket.emit(
      'messages',
      [...sortedMessages].slice(Math.max(sortedMessages.length - 50, 0))
    );
  } else {
    socket.emit('messages', allMessages);
  }
}

io.on('connection', (socket) => {
  console.log('a user connected: ', socket.id);

  socket.on('join-chat', async (data: JoinChatData) => {
    socket.join(data.roomName);
    // await prisma.message.deleteMany({});

    console.log('init message: ', data.initialMessage);
    const initialMessage: ChatMessageData | null = data.initialMessage
      ? {
          roomName: data.roomName,
          roomId: data.roomId,
          content: data.initialMessage,
          createdAt: new Date(),
          sender: { ...data.sender },
        }
      : null;
    await fetchAndEmitMessages(data.roomId, socket, initialMessage);

    socket.on('leave-chat', (data: Chat) => {
      console.log('leave-chat: ', data);
      socket.leave(data.id);
      socket.to(data.id).emit('leave-chat', data);
    });
  });

  // listen to a chat-messge
  socket.on('chat-message', async (data: ChatMessageData) => {
    console.log('chat-message: ', data.content);
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
  socket.on('typing', (data: TypingData) => {
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
  console.log('Server started on port 3001');
});
