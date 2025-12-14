const API_URL = 'http://31.57.109.22';
const SOCKET_URL = 'http://31.57.109.22';

// Check authentication
const token = localStorage.getItem('token');
const user = JSON.parse(localStorage.getItem('user') || '{}');

if (!token || !user.id) {
    window.location.href = 'index.html';
}

// Global variables
let socket;
let currentChatId = null;
let currentChatData = null;
let allUsers = [];
let allChats = [];
let selectedGroupUsers = [];
let typingTimeouts = {};
let unreadMessages = {};

// WebRTC
let localStream = null;
let remoteStream = null;
let peerConnection = null;
let currentCallUser = null;
let isCallInitiator = false;

const rtcConfiguration = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
    ]
};

// Elements
const currentUsername = document.getElementById('currentUsername');
const logoutBtn = document.getElementById('logoutBtn');
const createChatBtn = document.getElementById('createChatBtn');
const chatsList = document.getElementById('chatsList');
const emptyState = document.getElementById('emptyState');
const chatContainer = document.getElementById('chatContainer');
const chatName = document.getElementById('chatName');
const chatStatus = document.getElementById('chatStatus');
const messagesContainer = document.getElementById('messagesContainer');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
const typingIndicator = document.getElementById('typingIndicator');
const voiceCallBtn = document.getElementById('voiceCallBtn');
const videoCallBtn = document.getElementById('videoCallBtn');

// Modal elements
const createChatModal = document.getElementById('createChatModal');
const closeChatModal = document.getElementById('closeChatModal');
const usersList = document.getElementById('usersList');
const groupUsersList = document.getElementById('groupUsersList');
const searchUsers = document.getElementById('searchUsers');
const searchGroupUsers = document.getElementById('searchGroupUsers');
const groupName = document.getElementById('groupName');
const createGroupBtn = document.getElementById('createGroupBtn');
const selectedUsersContainer = document.getElementById('selectedUsers');

// Context menu
const contextMenu = document.getElementById('contextMenu');
let currentContextMessage = null;

// Call elements
const callModal = document.getElementById('callModal');
const callerName = document.getElementById('callerName');
const callStatus = document.getElementById('callStatus');
const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
const muteBtn = document.getElementById('muteBtn');
const cameraBtn = document.getElementById('cameraBtn');
const endCallBtn = document.getElementById('endCallBtn');
const acceptCallBtn = document.getElementById('acceptCallBtn');
const rejectCallBtn = document.getElementById('rejectCallBtn');
const incomingCallActions = document.getElementById('incomingCallActions');

// Audio elements
const notificationSound = document.getElementById('notificationSound');
const ringtoneSound = document.getElementById('ringtoneSound');

// Set current user
currentUsername.textContent = user.username;

// ============= SOCKET CONNECTION =============
function connectSocket() {
    socket = io(SOCKET_URL);

    socket.on('connect', () => {
        console.log('Connected to server');
        socket.emit('authenticate', { token });
    });

    socket.on('auth_error', () => {
        localStorage.clear();
        window.location.href = 'index.html';
    });

    socket.on('message', (data) => {
        // Приводим ID к числу для корректного сравнения
        const messageUserId = parseInt(data.userId);
        const currentUserId = parseInt(user.id);

        if (data.chatId === currentChatId) {
            displayMessage(data);
            scrollToBottom();
        } else if (messageUserId !== currentUserId) {
            // Unread message (только если не от меня!)
            if (!unreadMessages[data.chatId]) {
                unreadMessages[data.chatId] = 0;
            }
            unreadMessages[data.chatId]++;
            updateChatUnread(data.chatId);
            playNotification();
        }
        updateChatLastMessage(data.chatId, data);
    });

    socket.on('message_edited', (data) => {
        const messageEl = document.querySelector(`[data-message-id="${data.messageId}"]`);
        if (messageEl) {
            const textEl = messageEl.querySelector('.message-text');
            const footerEl = messageEl.querySelector('.message-footer');

            textEl.textContent = data.text;

            if (!footerEl.querySelector('.message-edited')) {
                const editedSpan = document.createElement('span');
                editedSpan.className = 'message-edited';
                editedSpan.textContent = 'изменено';
                footerEl.insertBefore(editedSpan, footerEl.firstChild);
            }
        }
    });

    socket.on('message_deleted', (data) => {
        const messageEl = document.querySelector(`[data-message-id="${data.messageId}"]`);
        if (messageEl) {
            messageEl.remove();
        }
    });

    socket.on('typing_start', (data) => {
        if (data.chatId === currentChatId && data.userId !== user.id) {
            typingIndicator.textContent = `${data.username} печатает...`;
            typingIndicator.style.display = 'block';
        }
    });

    socket.on('typing_stop', (data) => {
        if (data.chatId === currentChatId && data.userId !== user.id) {
            typingIndicator.style.display = 'none';
        }
    });

    // Call events
    socket.on('incoming_call', async (data) => {
        currentCallUser = data.callerId;
        callerName.textContent = data.callerName;
        callStatus.textContent = 'Входящий звонок...';
        incomingCallActions.style.display = 'flex';
        document.querySelector('.call-controls').style.display = 'none';
        callModal.classList.add('show');
        playRingtone();

        // Store offer for later
        window.incomingOffer = data.offer;
    });

    socket.on('call_answered', async (data) => {
        stopRingtone();
        callStatus.textContent = 'Соединение...';

        if (peerConnection) {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
            callStatus.textContent = 'В разговоре';
        }
    });

    socket.on('call_rejected', () => {
        stopRingtone();
        endCall();
        alert('Звонок отклонен');
    });

    socket.on('call_ended', () => {
        stopRingtone();
        endCall();
    });

    socket.on('ice_candidate', async (data) => {
        if (peerConnection && data.candidate) {
            try {
                await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
            } catch (error) {
                console.error('Error adding ICE candidate:', error);
            }
        }
    });

    socket.on('user_disconnected', (data) => {
        if (data.userId === currentCallUser) {
            endCall();
        }
        updateUserStatus(data.userId, false);
    });

    socket.on('users', (users) => {
        users.forEach(u => {
            if (u.id !== user.id) {
                updateUserStatus(u.id, true);
            }
        });
    });

    socket.on('disconnect', () => {
        console.log('Disconnected from server');
    });
}

connectSocket();

// ============= CHAT FUNCTIONS =============
async function loadChats() {
    try {
        const response = await fetch(`${API_URL}/api/chats/${user.id}`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (!response.ok) throw new Error('Failed to load chats');

        allChats = await response.json();
        displayChats(allChats);
    } catch (error) {
        console.error('Error loading chats:', error);
    }
}

function displayChats(chats) {
    chatsList.innerHTML = '';

    if (chats.length === 0) {
        chatsList.innerHTML = '<p style="text-align: center; color: var(--text-secondary); padding: 20px;">Нет чатов</p>';
        return;
    }

    chats.forEach(chat => {
        const chatEl = createChatElement(chat);
        chatsList.appendChild(chatEl);
    });
}

function createChatElement(chat) {
    const div = document.createElement('div');
    div.className = 'chat-item';
    div.dataset.chatId = chat.id;

    let chatDisplayName = chat.name || 'Личный чат';
    let otherUser = null;

    if (!chat.is_group && chat.participants) {
        otherUser = chat.participants.find(p => p.id !== user.id);
        chatDisplayName = otherUser ? otherUser.username : 'Неизвестный';
    }

    const lastMessage = chat.last_message;
    const lastMessageText = lastMessage ? lastMessage.text : 'Нет сообщений';
    const lastMessageTime = lastMessage ? formatTime(lastMessage.timestamp) : '';

    const unreadCount = unreadMessages[chat.id] || 0;

    div.innerHTML = `
        <div class="avatar">
            <i class="fas ${chat.is_group ? 'fa-users' : 'fa-user'}"></i>
            ${!chat.is_group && otherUser ? `<span class="status-indicator" data-user-id="${otherUser.id}"></span>` : ''}
        </div>
        <div class="chat-item-info">
            <div class="chat-item-header">
                <span class="chat-item-name">${chatDisplayName}</span>
                <span class="chat-item-time">${lastMessageTime}</span>
            </div>
            <div class="chat-item-message">${lastMessageText}</div>
        </div>
        ${unreadCount > 0 ? `<span class="unread-badge">${unreadCount}</span>` : ''}
    `;

    div.addEventListener('click', () => openChat(chat));

    return div;
}

async function openChat(chat) {
    currentChatId = chat.id;
    currentChatData = chat;

    // Clear unread
    if (unreadMessages[chat.id]) {
        unreadMessages[chat.id] = 0;
        updateChatUnread(chat.id);
    }

    // Update UI
    document.querySelectorAll('.chat-item').forEach(el => el.classList.remove('active'));
    document.querySelector(`[data-chat-id="${chat.id}"]`)?.classList.add('active');

    emptyState.style.display = 'none';
    chatContainer.style.display = 'flex';

    let chatDisplayName = chat.name || 'Личный чат';
    let otherUser = null;

    if (!chat.is_group && chat.participants) {
        otherUser = chat.participants.find(p => p.id !== user.id);
        chatDisplayName = otherUser ? otherUser.username : 'Неизвестный';
    }

    chatName.textContent = chatDisplayName;

    // Join socket room
    socket.emit('join_chat', { chatId: chat.id });

    // Load messages
    await loadMessages(chat.id);

    messageInput.focus();
}

async function loadMessages(chatId) {
    try {
        const response = await fetch(`${API_URL}/api/chats/${chatId}/messages`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (!response.ok) throw new Error('Failed to load messages');

        const messages = await response.json();
        messagesContainer.innerHTML = '';

        messages.forEach(msg => displayMessage(msg));
        scrollToBottom();
    } catch (error) {
        console.error('Error loading messages:', error);
    }
}

function displayMessage(msg) {
    const div = document.createElement('div');
    // Приводим ID к числу для корректного сравнения
    const messageUserId = parseInt(msg.userId || msg.user_id);
    const currentUserId = parseInt(user.id);
    const isOwn = messageUserId === currentUserId;

    div.className = `message ${isOwn ? 'own' : ''}`;
    div.dataset.messageId = msg.id;
    div.dataset.userId = messageUserId;

    const time = formatTime(msg.timestamp);

    div.innerHTML = `
        <div class="avatar">
            <i class="fas fa-user"></i>
        </div>
        <div class="message-content">
            ${!isOwn ? `<div class="message-author">${msg.username}</div>` : ''}
            <div class="message-bubble">
                <div class="message-text">${escapeHtml(msg.text)}</div>
            </div>
            <div class="message-footer">
                ${msg.edited ? '<span class="message-edited">изменено</span>' : ''}
                <span class="message-time">${time}</span>
            </div>
        </div>
    `;

    // Context menu
    div.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        showContextMenu(e, msg);
    });

    messagesContainer.appendChild(div);
}

function sendMessage() {
    const text = messageInput.value.trim();

    if (!text || !currentChatId) return;

    socket.emit('message', {
        chatId: currentChatId,
        text: text
    });

    messageInput.value = '';
    autoResize(messageInput);
    stopTyping();
}

// ============= TYPING INDICATOR =============
let isTyping = false;
let typingTimeout = null;

function startTyping() {
    if (!isTyping && currentChatId) {
        isTyping = true;
        socket.emit('typing_start', {
            chatId: currentChatId,
            userId: user.id,
            username: user.username
        });
    }

    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(stopTyping, 3000);
}

function stopTyping() {
    if (isTyping && currentChatId) {
        isTyping = false;
        socket.emit('typing_stop', {
            chatId: currentChatId,
            userId: user.id
        });
    }
}

// ============= CONTEXT MENU =============
function showContextMenu(e, msg) {
    currentContextMessage = msg;

    // Show/hide options based on ownership
    const editItem = contextMenu.querySelector('[data-action="edit"]');
    const deleteAllItem = contextMenu.querySelector('[data-action="delete-all"]');

    if (msg.user_id === user.id) {
        editItem.style.display = 'flex';
        deleteAllItem.style.display = 'flex';
    } else {
        editItem.style.display = 'none';
        deleteAllItem.style.display = 'none';
    }

    contextMenu.style.left = e.pageX + 'px';
    contextMenu.style.top = e.pageY + 'px';
    contextMenu.classList.add('show');
}

function hideContextMenu() {
    contextMenu.classList.remove('show');
    currentContextMessage = null;
}

// Context menu actions
contextMenu.querySelectorAll('.context-item').forEach(item => {
    item.addEventListener('click', async () => {
        const action = item.dataset.action;

        switch (action) {
            case 'edit':
                editMessage(currentContextMessage);
                break;
            case 'copy':
                copyMessage(currentContextMessage);
                break;
            case 'delete-me':
                // For now, same as delete all (backend doesn't support per-user deletion)
                deleteMessage(currentContextMessage, false);
                break;
            case 'delete-all':
                deleteMessage(currentContextMessage, true);
                break;
        }

        hideContextMenu();
    });
});

async function editMessage(msg) {
    const newText = prompt('Редактировать сообщение:', msg.text);

    if (newText && newText.trim() && newText !== msg.text) {
        socket.emit('edit_message', {
            messageId: msg.id,
            text: newText.trim(),
            chatId: currentChatId
        });
    }
}

function copyMessage(msg) {
    navigator.clipboard.writeText(msg.text);
}

async function deleteMessage(msg, forAll) {
    if (!confirm(forAll ? 'Удалить сообщение у всех?' : 'Удалить сообщение?')) {
        return;
    }

    socket.emit('delete_message_all', {
        messageId: msg.id,
        chatId: currentChatId
    });
}

// ============= CREATE CHAT =============
async function loadUsers() {
    try {
        const response = await fetch(`${API_URL}/api/users`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (!response.ok) throw new Error('Failed to load users');

        allUsers = await response.json();
        allUsers = allUsers.filter(u => u.id !== user.id);

        displayUsers(allUsers, usersList);
        displayUsers(allUsers, groupUsersList, true);
    } catch (error) {
        console.error('Error loading users:', error);
    }
}

function displayUsers(users, container, isGroupMode = false) {
    container.innerHTML = '';

    users.forEach(u => {
        const div = document.createElement('div');
        div.className = 'user-item';
        div.dataset.userId = u.id;

        div.innerHTML = `
            <div class="avatar">
                <i class="fas fa-user"></i>
                <span class="status-indicator" data-user-id="${u.id}"></span>
            </div>
            <div class="user-item-info">
                <div class="user-item-name">${u.username}</div>
            </div>
        `;

        if (isGroupMode) {
            div.addEventListener('click', () => toggleGroupUser(u, div));
        } else {
            div.addEventListener('click', () => createPrivateChat(u.id));
        }

        container.appendChild(div);
    });
}

async function createPrivateChat(otherUserId) {
    try {
        const response = await fetch(`${API_URL}/api/chats/private`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                userId: user.id,
                otherUserId: otherUserId
            })
        });

        if (!response.ok) throw new Error('Failed to create chat');

        const data = await response.json();

        createChatModal.classList.remove('show');

        if (!data.existed) {
            await loadChats();
        }

        const chat = allChats.find(c => c.id === data.chat.id);
        if (chat) {
            openChat(chat);
        }
    } catch (error) {
        console.error('Error creating private chat:', error);
        alert('Ошибка создания чата');
    }
}

function toggleGroupUser(u, div) {
    const index = selectedGroupUsers.findIndex(user => user.id === u.id);

    if (index === -1) {
        selectedGroupUsers.push(u);
        div.classList.add('selected');
    } else {
        selectedGroupUsers.splice(index, 1);
        div.classList.remove('selected');
    }

    updateSelectedUsers();
}

function updateSelectedUsers() {
    selectedUsersContainer.innerHTML = '';

    selectedGroupUsers.forEach(u => {
        const chip = document.createElement('div');
        chip.className = 'selected-user-chip';
        chip.innerHTML = `
            <span>${u.username}</span>
            <i class="fas fa-times"></i>
        `;

        chip.querySelector('i').addEventListener('click', () => {
            selectedGroupUsers = selectedGroupUsers.filter(user => user.id !== u.id);
            updateSelectedUsers();

            const userDiv = groupUsersList.querySelector(`[data-user-id="${u.id}"]`);
            if (userDiv) userDiv.classList.remove('selected');
        });

        selectedUsersContainer.appendChild(chip);
    });
}

async function createGroupChat() {
    const name = groupName.value.trim();

    if (!name) {
        alert('Введите название группы');
        return;
    }

    if (selectedGroupUsers.length === 0) {
        alert('Выберите хотя бы одного участника');
        return;
    }

    try {
        const response = await fetch(`${API_URL}/api/chats/group`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                userId: user.id,
                name: name,
                participants: selectedGroupUsers.map(u => u.id)
            })
        });

        if (!response.ok) throw new Error('Failed to create group');

        const data = await response.json();

        createChatModal.classList.remove('show');
        groupName.value = '';
        selectedGroupUsers = [];
        updateSelectedUsers();

        await loadChats();

        const chat = allChats.find(c => c.id === data.chat.id);
        if (chat) {
            openChat(chat);
        }
    } catch (error) {
        console.error('Error creating group chat:', error);
        alert('Ошибка создания группы');
    }
}

// ============= CALLS =============
async function initiateCall(isVideo) {
    if (!currentChatData || currentChatData.is_group) {
        alert('Звонки доступны только в личных чатах');
        return;
    }

    const otherUser = currentChatData.participants.find(p => p.id !== user.id);
    if (!otherUser) return;

    currentCallUser = otherUser.id;
    callerName.textContent = otherUser.username;
    callStatus.textContent = 'Вызов...';
    isCallInitiator = true;

    callModal.classList.add('show');
    incomingCallActions.style.display = 'none';
    document.querySelector('.call-controls').style.display = 'flex';

    // НЕ играем рингтон у звонящего! Только у принимающего

    try {
        localStream = await navigator.mediaDevices.getUserMedia({
            audio: true,
            video: isVideo
        });

        localVideo.srcObject = localStream;
        localVideo.style.display = isVideo ? 'block' : 'none';

        peerConnection = new RTCPeerConnection(rtcConfiguration);

        localStream.getTracks().forEach(track => {
            peerConnection.addTrack(track, localStream);
        });

        peerConnection.ontrack = (event) => {
            console.log('📹 Received remote stream');
            remoteVideo.srcObject = event.streams[0];
            stopRingtone();
            callStatus.textContent = 'В разговоре';
        };

        peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                console.log('🧊 Sending ICE candidate');
                socket.emit('ice_candidate', {
                    targetUserId: currentCallUser,
                    candidate: event.candidate
                });
            }
        };

        peerConnection.onconnectionstatechange = () => {
            console.log('🔗 Connection state:', peerConnection.connectionState);
            if (peerConnection.connectionState === 'connected') {
                callStatus.textContent = 'В разговоре';
            } else if (peerConnection.connectionState === 'failed') {
                alert('Ошибка соединения');
                endCall();
            }
        };

        peerConnection.oniceconnectionstatechange = () => {
            console.log('❄️ ICE connection state:', peerConnection.iceConnectionState);
        };

        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);

        socket.emit('call_initiate', {
            targetUserId: currentCallUser,
            offer: offer
        });

    } catch (error) {
        console.error('Error initiating call:', error);
        alert('Не удалось получить доступ к камере/микрофону');
        endCall();
    }
}

async function acceptCall() {
    stopRingtone();
    incomingCallActions.style.display = 'none';
    document.querySelector('.call-controls').style.display = 'flex';
    callStatus.textContent = 'Соединение...';

    try {
        localStream = await navigator.mediaDevices.getUserMedia({
            audio: true,
            video: true
        });

        localVideo.srcObject = localStream;

        peerConnection = new RTCPeerConnection(rtcConfiguration);

        localStream.getTracks().forEach(track => {
            peerConnection.addTrack(track, localStream);
        });

        peerConnection.ontrack = (event) => {
            console.log('📹 Received remote stream');
            remoteVideo.srcObject = event.streams[0];
            callStatus.textContent = 'В разговоре';
        };

        peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                console.log('🧊 Sending ICE candidate');
                socket.emit('ice_candidate', {
                    targetUserId: currentCallUser,
                    candidate: event.candidate
                });
            }
        };

        peerConnection.onconnectionstatechange = () => {
            console.log('🔗 Connection state:', peerConnection.connectionState);
            if (peerConnection.connectionState === 'connected') {
                callStatus.textContent = 'В разговоре';
            } else if (peerConnection.connectionState === 'failed') {
                alert('Ошибка соединения');
                endCall();
            }
        };

        peerConnection.oniceconnectionstatechange = () => {
            console.log('❄️ ICE connection state:', peerConnection.iceConnectionState);
        };

        console.log('📞 Setting remote description (offer)');
        await peerConnection.setRemoteDescription(new RTCSessionDescription(window.incomingOffer));

        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);

        socket.emit('call_answer', {
            callerId: currentCallUser,
            answer: answer
        });

    } catch (error) {
        console.error('Error accepting call:', error);
        alert('Не удалось принять звонок');
        endCall();
    }
}

function rejectCall() {
    stopRingtone();
    socket.emit('call_reject', { callerId: currentCallUser });
    endCall();
}

function endCall() {
    stopRingtone();

    if (currentCallUser && isCallInitiator) {
        socket.emit('call_end', { targetUserId: currentCallUser });
    }

    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }

    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }

    localVideo.srcObject = null;
    remoteVideo.srcObject = null;
    callModal.classList.remove('show');

    currentCallUser = null;
    isCallInitiator = false;
}

function toggleMute() {
    if (localStream) {
        const audioTrack = localStream.getAudioTracks()[0];
        audioTrack.enabled = !audioTrack.enabled;

        muteBtn.classList.toggle('muted', !audioTrack.enabled);
    }
}

function toggleCamera() {
    if (localStream) {
        const videoTrack = localStream.getVideoTracks()[0];
        if (videoTrack) {
            videoTrack.enabled = !videoTrack.enabled;
            cameraBtn.classList.toggle('off', !videoTrack.enabled);
            localVideo.style.display = videoTrack.enabled ? 'block' : 'none';
        }
    }
}

// ============= NOTIFICATIONS =============
function playNotification() {
    if (notificationSound) {
        notificationSound.currentTime = 0;
        notificationSound.play().catch(e => console.log('Cannot play notification:', e));
    }
}

function playRingtone() {
    if (ringtoneSound) {
        ringtoneSound.currentTime = 0;
        ringtoneSound.play().catch(e => console.log('Cannot play ringtone:', e));
    }
}

function stopRingtone() {
    if (ringtoneSound) {
        ringtoneSound.pause();
        ringtoneSound.currentTime = 0;
    }
}

// ============= HELPERS =============
function formatTime(timestamp) {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now - date;

    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');

    if (diff < 86400000) { // Less than 24 hours
        return `${hours}:${minutes}`;
    } else if (diff < 604800000) { // Less than 7 days
        const days = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
        return `${days[date.getDay()]} ${hours}:${minutes}`;
    } else {
        return `${date.getDate()}.${(date.getMonth() + 1).toString().padStart(2, '0')}`;
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function scrollToBottom() {
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function autoResize(textarea) {
    textarea.style.height = 'auto';
    textarea.style.height = textarea.scrollHeight + 'px';
}

function updateChatLastMessage(chatId, message) {
    const chatEl = document.querySelector(`[data-chat-id="${chatId}"]`);
    if (chatEl) {
        const messageEl = chatEl.querySelector('.chat-item-message');
        const timeEl = chatEl.querySelector('.chat-item-time');

        if (messageEl) messageEl.textContent = message.text;
        if (timeEl) timeEl.textContent = formatTime(message.timestamp);

        // Move to top
        chatsList.insertBefore(chatEl, chatsList.firstChild);
    }
}

function updateChatUnread(chatId) {
    const chatEl = document.querySelector(`[data-chat-id="${chatId}"]`);
    if (chatEl) {
        const badgeEl = chatEl.querySelector('.unread-badge');
        const count = unreadMessages[chatId] || 0;

        if (count > 0) {
            if (badgeEl) {
                badgeEl.textContent = count;
            } else {
                const badge = document.createElement('span');
                badge.className = 'unread-badge';
                badge.textContent = count;
                chatEl.appendChild(badge);
            }
        } else {
            if (badgeEl) badgeEl.remove();
        }
    }
}

function updateUserStatus(userId, isOnline) {
    document.querySelectorAll(`[data-user-id="${userId}"]`).forEach(el => {
        if (isOnline) {
            el.classList.add('online');
        } else {
            el.classList.remove('online');
        }
    });
}

// ============= EVENT LISTENERS =============
logoutBtn.addEventListener('click', () => {
    if (confirm('Выйти из аккаунта?')) {
        localStorage.clear();
        window.location.href = 'index.html';
    }
});

createChatBtn.addEventListener('click', () => {
    createChatModal.classList.add('show');
    loadUsers();
});

closeChatModal.addEventListener('click', () => {
    createChatModal.classList.remove('show');
});

createChatModal.addEventListener('click', (e) => {
    if (e.target === createChatModal) {
        createChatModal.classList.remove('show');
    }
});

document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
        const tabName = tab.dataset.tab;

        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

        tab.classList.add('active');
        document.querySelector(`[data-content="${tabName}"]`).classList.add('active');
    });
});

createGroupBtn.addEventListener('click', createGroupChat);

sendBtn.addEventListener('click', sendMessage);

messageInput.addEventListener('input', () => {
    autoResize(messageInput);
    startTyping();
});

messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
});

searchUsers.addEventListener('input', (e) => {
    const query = e.target.value.toLowerCase();
    const filtered = allUsers.filter(u => u.username.toLowerCase().includes(query));
    displayUsers(filtered, usersList);
});

searchGroupUsers.addEventListener('input', (e) => {
    const query = e.target.value.toLowerCase();
    const filtered = allUsers.filter(u => u.username.toLowerCase().includes(query));
    displayUsers(filtered, groupUsersList, true);
});

document.getElementById('searchChats').addEventListener('input', (e) => {
    const query = e.target.value.toLowerCase();
    const filtered = allChats.filter(chat => {
        if (chat.is_group) {
            return chat.name.toLowerCase().includes(query);
        } else {
            const otherUser = chat.participants.find(p => p.id !== user.id);
            return otherUser && otherUser.username.toLowerCase().includes(query);
        }
    });
    displayChats(filtered);
});

document.addEventListener('click', (e) => {
    if (!contextMenu.contains(e.target)) {
        hideContextMenu();
    }
});

voiceCallBtn.addEventListener('click', () => initiateCall(false));
videoCallBtn.addEventListener('click', () => initiateCall(true));
acceptCallBtn.addEventListener('click', acceptCall);
rejectCallBtn.addEventListener('click', rejectCall);
endCallBtn.addEventListener('click', endCall);
muteBtn.addEventListener('click', toggleMute);
cameraBtn.addEventListener('click', toggleCamera);

// ============= INITIALIZATION =============
loadChats();
