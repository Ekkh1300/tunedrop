/**
 * Socket singleton. Reconnection is socket.io's steady job — the store simply
 * re-joins the room and refetches the (server-persisted) library on every
 * reconnect, which is what makes "offline then back online" lossless.
 */
import { io } from 'socket.io-client'

export const socket = io({
  autoConnect: false,
  transports: ['websocket', 'polling'],
  reconnection: true,
  reconnectionDelay: 700,
  reconnectionDelayMax: 5000,
  reconnectionAttempts: Infinity,
})
