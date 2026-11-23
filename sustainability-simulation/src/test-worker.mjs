import { TestClassroom } from './test-classroom.mjs?v=6f29d502ed18';

const rooms = new Map();
const subscriptions = new Map();
function notify(roomId, event) {
  for (const [port, subscribedRoom] of subscriptions) {
    if (subscribedRoom !== roomId) continue;
    try { port.postMessage({event, roomId}); } catch { subscriptions.delete(port); }
    if (event === 'ended') subscriptions.delete(port);
  }
}
// A durable transaction completes before an action is acknowledged or broadcast.
let database;
function storage(method, value) {
  database ||= new Promise((resolve,reject) => {
    const request = indexedDB.open('sustainability-test-classrooms', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('rooms', {keyPath:'state.id'});
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return database.then(db => new Promise((resolve,reject) => {
    const tx = db.transaction('rooms', ['get','getAll'].includes(method) ? 'readonly' : 'readwrite');
    const request = tx.objectStore('rooms')[method](value);
    tx.oncomplete = () => resolve(request.result);
    tx.onabort = tx.onerror = () => reject(tx.error || new Error('Test data could not be saved. Free browser storage and try again.'));
  }));
}
let queue = Promise.resolve();
function enqueue(task) { const result = queue.then(task); queue = result.catch(() => {}); return result; }
onconnect = event => {
  const port = event.ports[0];
  port.onmessage = ({data}) => enqueue(async () => {
    const {requestId, action, roomId, key, payload} = data;
    if (action === 'disconnect') { subscriptions.delete(port); port.close(); return; }
    try {
      let room = rooms.get(roomId), result;
      if (action === 'list') {
        result = (await storage('getAll')).filter(saved => saved.metadata?.owner === payload.owner && (!payload.source || saved.metadata?.source === payload.source)).map(saved => ({roomId:saved.state.id,key:saved.people[0].key,name:saved.state.name,hour:saved.state.hour,students:saved.people.length-1}));
      } else if (action === 'create') {
        room = new TestClassroom(payload.template, payload.groups);
        room.metadata = payload.metadata || {};
        await storage('put', room.snapshot());
        rooms.set(room.state.id, room);
        result = {roomId:room.state.id, key:room.people[0].key};
      } else {
        if (!room) {
          const saved = await storage('get', roomId);
          if (saved) { room = TestClassroom.restore(saved); await storage('put',room.snapshot()); rooms.set(roomId,room); }
        }
        if (!room) throw Object.assign(new Error('This test session was deleted or is not saved in this browser profile.'), {status:410});
        room.actor(key);
        subscriptions.set(port, roomId);
        if (action === 'view') result = room.view(key, payload?.preview);
        else if (action === 'typing') result = room.typing(key, payload?.active);
        else if (action === 'command') {
          const before = room.snapshot(), nextTick = room.nextTick;
          try { result = room.command(key,payload); await storage('put',room.snapshot()); }
          catch(error) { const restored = TestClassroom.restore(before); restored.state = before.state; restored.nextTick = nextTick; rooms.set(roomId,restored); throw error; }
        }
        else if (action === 'roster') result = room.roster(key);
        else if (action === 'end') { room.roster(key); await storage('delete',roomId); rooms.delete(roomId); result = {ok:true}; }
        else throw new Error('Unknown test-round action.');
      }
      port.postMessage({requestId,result});
      if (action === 'command') notify(roomId, 'changed');
      if (action === 'end') notify(roomId, 'ended');
    } catch(error) { port.postMessage({requestId,error:error.message,status:error.status || 400}); }
  });
  port.start();
};
setInterval(() => enqueue(async () => {
  for (const [roomId, room] of rooms) {
    if (![...subscriptions.values()].includes(roomId)) { rooms.delete(roomId); continue; }
    if (room.state.status !== 'running') continue;
    const before = room.snapshot();
    room.advance(Date.now());
    if (room.state.revision !== before.state.revision) {
      try { await storage('put',room.snapshot()); notify(roomId, 'changed'); }
      catch { rooms.set(roomId,TestClassroom.restore(before)); notify(roomId,'save-error'); }
    }
  }
}), 1000);
