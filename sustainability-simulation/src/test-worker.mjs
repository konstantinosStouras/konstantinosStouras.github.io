import { TestClassroom } from './test-classroom.mjs?v=5366cc14c565';

const rooms = new Map();
const subscriptions = new Map();
function notify(roomId, event) {
  for (const [port, subscribedRoom] of subscriptions) {
    if (subscribedRoom !== roomId) continue;
    try { port.postMessage({event, roomId}); } catch { subscriptions.delete(port); }
    if (event === 'ended') subscriptions.delete(port);
  }
}
onconnect = event => {
  const port = event.ports[0];
  port.onmessage = ({data}) => {
    const {requestId, action, roomId, key, payload} = data;
    if (action === 'disconnect') { subscriptions.delete(port); port.close(); return; }
    try {
      let room = rooms.get(roomId), result;
      if (action === 'create') {
        room = new TestClassroom(payload.template, payload.groups); rooms.set(room.state.id, room);
        result = {roomId:room.state.id, key:room.people[0].key};
      } else {
        if (!room) throw Object.assign(new Error('This temporary test round has ended. Start a new test round from your instructor workspace.'), {status:410});
        room.actor(key);
        subscriptions.set(port, roomId);
        if (action === 'view') result = room.view(key, payload?.preview);
        else if (action === 'command') result = room.command(key,payload);
        else if (action === 'roster') result = room.roster(key);
        else if (action === 'end') { room.roster(key); rooms.delete(roomId); result = {ok:true}; }
        else throw new Error('Unknown test-round action.');
      }
      port.postMessage({requestId,result});
      if (action === 'command') notify(roomId, 'changed');
      if (action === 'end') notify(roomId, 'ended');
    } catch(error) { port.postMessage({requestId,error:error.message,status:error.status || 400}); }
  };
  port.start();
};
setInterval(() => {
  for (const [roomId, room] of rooms) {
    const revision = room.state.revision;
    room.advance(Date.now());
    if (room.state.revision !== revision) notify(roomId, 'changed');
  }
}, 1000);
