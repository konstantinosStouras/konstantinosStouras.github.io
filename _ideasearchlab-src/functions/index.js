const functions = require('firebase-functions/v1').region('europe-west1')
const admin = require('firebase-admin')

admin.initializeApp()

// Export each module's functions with europe-west1 region
const session = require('./session')
const grouping = require('./grouping')
const ai = require('./ai')
const users = require('./users')

exports.joinSession = session.joinSession
exports.advancePhase = session.advancePhase
exports.removeParticipant = session.removeParticipant
exports.deleteSessionDeep = session.deleteSessionDeep
exports.autoGroupParticipants = grouping.autoGroupParticipants
exports.handleStragglers = grouping.handleStragglers
exports.sendAIMessage = ai.sendAIMessage
exports.saveAISettings = ai.saveAISettings
exports.onParticipantUpdated = session.onParticipantUpdated
exports.listRegisteredUsers = users.listRegisteredUsers
exports.deleteAllRegisteredUsers = users.deleteAllRegisteredUsers
exports.deleteRegisteredUser = users.deleteRegisteredUser