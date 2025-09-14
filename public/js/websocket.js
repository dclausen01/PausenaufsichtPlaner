// WebSocket connection for real-time updates
class WebSocketManager {
    constructor() {
        this.socket = null;
        this.connected = false;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectDelay = 1000;
    }

    connect() {
        try {
            this.socket = io();
            this.setupEventListeners();
        } catch (error) {
            console.error('Failed to connect to WebSocket:', error);
            this.scheduleReconnect();
        }
    }

    setupEventListeners() {
        this.socket.on('connect', () => {
            console.log('Connected to server');
            this.connected = true;
            this.reconnectAttempts = 0;
            this.showStatusMessage('Verbindung hergestellt', 'success');
        });

        this.socket.on('disconnect', () => {
            console.log('Disconnected from server');
            this.connected = false;
            this.showStatusMessage('Verbindung unterbrochen', 'error');
            this.scheduleReconnect();
        });

        this.socket.on('connect_error', (error) => {
            console.error('Connection error:', error);
            this.connected = false;
            this.scheduleReconnect();
        });

        // Assignment events
        this.socket.on('assignmentCreated', (assignment) => {
            this.handleAssignmentCreated(assignment);
        });

        this.socket.on('assignmentUpdated', (assignment) => {
            this.handleAssignmentUpdated(assignment);
        });

        this.socket.on('assignmentDeleted', (data) => {
            this.handleAssignmentDeleted(data);
        });
    }

    scheduleReconnect() {
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
            
            console.log(`Attempting to reconnect in ${delay}ms (attempt ${this.reconnectAttempts})`);
            
            setTimeout(() => {
                if (!this.connected) {
                    this.connect();
                }
            }, delay);
        } else {
            this.showStatusMessage('Verbindung konnte nicht wiederhergestellt werden', 'error');
        }
    }

    handleAssignmentCreated(assignment) {
        console.log('Assignment created:', assignment);
        this.updateScheduleSlot(assignment, 'created');
        this.showStatusMessage(`Neue Zuweisung: ${assignment.teacher_name} für ${assignment.area_name}`, 'info');
    }

    handleAssignmentUpdated(assignment) {
        console.log('Assignment updated:', assignment);
        this.updateScheduleSlot(assignment, 'updated');
        this.showStatusMessage(`Zuweisung geändert: ${assignment.teacher_name} für ${assignment.area_name}`, 'info');
    }

    handleAssignmentDeleted(data) {
        console.log('Assignment deleted:', data);
        this.removeScheduleSlot(data.id);
        this.showStatusMessage('Zuweisung entfernt', 'info');
    }

    updateScheduleSlot(assignment, action) {
        // Find the corresponding slot in the UI
        const slotSelector = `[data-area-id="${assignment.area_id}"][data-time-slot-id="${assignment.time_slot_id}"][data-date="${assignment.date}"][data-supervision-number="${assignment.supervision_number}"]`;
        const slot = document.querySelector(slotSelector);
        
        if (slot) {
            // Update slot content and styling
            slot.textContent = assignment.teacher_name;
            slot.className = 'supervision-slot filled';
            slot.dataset.assignmentId = assignment.id;
            slot.dataset.teacherId = assignment.teacher_id;
            
            // Add a brief highlight effect
            slot.style.animation = 'none';
            slot.offsetHeight; // Trigger reflow
            slot.style.animation = 'highlight 1s ease-out';
        }
    }

    removeScheduleSlot(assignmentId) {
        // Find the slot by assignment ID
        const slot = document.querySelector(`[data-assignment-id="${assignmentId}"]`);
        
        if (slot) {
            // Reset slot to empty state
            slot.textContent = 'Leer';
            slot.className = 'supervision-slot empty';
            delete slot.dataset.assignmentId;
            delete slot.dataset.teacherId;
            
            // Add a brief highlight effect
            slot.style.animation = 'none';
            slot.offsetHeight; // Trigger reflow
            slot.style.animation = 'highlight 1s ease-out';
        }
    }

    showStatusMessage(message, type = 'info') {
        // Use the global status message function if available
        if (window.showStatusMessage) {
            window.showStatusMessage(message, type);
        } else {
            console.log(`${type.toUpperCase()}: ${message}`);
        }
    }

    joinRoom(room) {
        if (this.connected && this.socket) {
            this.socket.emit('joinRoom', room);
        }
    }

    disconnect() {
        if (this.socket) {
            this.socket.disconnect();
            this.socket = null;
            this.connected = false;
        }
    }
}

// Add highlight animation CSS
const style = document.createElement('style');
style.textContent = `
    @keyframes highlight {
        0% { background-color: #fff3cd; }
        100% { background-color: inherit; }
    }
`;
document.head.appendChild(style);

// Create global WebSocket manager instance
window.wsManager = new WebSocketManager();
