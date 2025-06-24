#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const chalk = require('chalk'); // Already in your dependencies

class VortexHiveLogBeautifier {
    constructor(options = {}) {
        this.options = {
            showTimestamps: options.showTimestamps !== false,
            groupRequests: options.groupRequests !== false,
            colorize: options.colorize !== false,
            indentSize: options.indentSize || 2,
            maxLineWidth: options.maxLineWidth || 120,
            showMemoryUsage: options.showMemoryUsage !== false,
            compactMode: options.compactMode || false,
            hideSocketMetrics: options.hideSocketMetrics || false,
            hideServerStats: options.hideServerStats || false,
            ...options
        };
        
        this.requestGroups = [];
        this.currentGroup = null;
    }

    // Main parsing method
    parse(logContent) {
        const lines = logContent.split('\n').filter(line => line.trim());
        const groupedLogs = this.groupLogs(lines);
        const beautifiedLines = [];
        
        for (const group of groupedLogs) {
            const formatted = this.formatLogGroup(group);
            if (formatted) beautifiedLines.push(formatted);
        }
        
        return beautifiedLines.join('\n\n');
    }

    // Group related log entries
    groupLogs(lines) {
        const groups = [];
        let currentGroup = null;
        
        for (const line of lines) {
            try {
                const logEntry = this.parseLogLine(line);
                if (!logEntry) continue;
                
                // Skip filtered entries
                if (this.shouldSkipEntry(logEntry)) continue;
                
                // Start new group for major events
                if (this.shouldStartNewGroup(logEntry)) {
                    if (currentGroup && currentGroup.entries.length > 0) {
                        groups.push(currentGroup);
                    }
                    currentGroup = {
                        type: logEntry.type,
                        startTime: logEntry.timestamp,
                        entries: [logEntry],
                        requestId: logEntry.requestId || null,
                        userId: logEntry.userId || null,
                        socketId: logEntry.socketId || null
                    };
                } else if (currentGroup && this.belongsToCurrentGroup(logEntry, currentGroup)) {
                    currentGroup.entries.push(logEntry);
                } else {
                    // Standalone entry
                    groups.push({
                        type: logEntry.type,
                        startTime: logEntry.timestamp,
                        entries: [logEntry],
                        requestId: logEntry.requestId || null,
                        userId: logEntry.userId || null,
                        socketId: logEntry.socketId || null
                    });
                }
            } catch (error) {
                // Handle unparseable lines
                if (currentGroup) {
                    currentGroup.entries.push({ type: 'raw', content: line, timestamp: null });
                } else {
                    groups.push({
                        type: 'raw',
                        startTime: null,
                        entries: [{ type: 'raw', content: line, timestamp: null }],
                        requestId: null
                    });
                }
            }
        }
        
        // Add the last group
        if (currentGroup && currentGroup.entries.length > 0) {
            groups.push(currentGroup);
        }
        
        return groups;
    }

    // Parse individual log line (handles your Winston JSON format)
    parseLogLine(line) {
        const trimmedLine = line.trim();
        if (!trimmedLine) return null;

        // Handle your Winston JSON format
        let jsonData = {};
        let message = trimmedLine;
        
        // Try to parse as pure JSON first (Winston JSON format)
        try {
            const parsed = JSON.parse(trimmedLine);
            if (parsed.timestamp && parsed.level && parsed.message) {
                jsonData = parsed;
                message = parsed.message;
            }
        } catch (e) {
            // Try to extract JSON from end of line (mixed format)
            const jsonMatch = trimmedLine.match(/(\{.*\})$/);
            if (jsonMatch) {
                try {
                    jsonData = JSON.parse(jsonMatch[1]);
                    message = trimmedLine.substring(0, jsonMatch.index).trim();
                } catch (e2) {
                    // Not valid JSON, treat as regular message
                }
            }
        }

        // Remove "info:" prefix if present
        message = message.replace(/^info:\s*/, '');

        const logEntry = {
            originalLine: line,
            message: message,
            data: jsonData,
            timestamp: jsonData.timestamp || this.extractTimestamp(line),
            type: this.determineLogType(message, jsonData),
            level: jsonData.level || this.extractLogLevel(line),
            requestId: jsonData.requestId || null,
            userId: jsonData.userId || jsonData.externalId || null,
            socketId: this.extractSocketId(message) || jsonData.socketId || null,
            ip: jsonData.ip || jsonData.clientIp || null,
            operationId: jsonData.operationId || null
        };

        return logEntry;
    }

    // Determine the type of log entry based on your server's log patterns
    determineLogType(message, data) {
        // Server statistics
        if (message.includes('📊 [Server] Connection statistics')) return 'server_stats';
        if (message.includes('📊 Socket.IO metrics')) return 'socket_metrics';
        
        // Authentication & User events
        if (message.includes('Token verified successfully')) return 'auth_success';
        if (message.includes('Socket authentication successful')) return 'socket_auth';
        if (message.includes('UserService: Finding user by externalId')) return 'user_lookup';
        if (message.includes('UserService: User found')) return 'user_found';
        
        // Socket.IO events
        if (message.includes('🔌 New socket connection')) return 'socket_connection';
        if (message.includes('✅ Socket handlers registered')) return 'socket_setup';
        if (message.includes('connected with socket')) return 'user_connected';
        
        // Database events
        if (message.includes('✅ Sequelize connection established')) return 'db_connection';
        
        // HTTP requests (your format)
        if (data.method && data.path) return 'http_request';
        if (data.statusCode && data.duration) return 'http_response';
        
        // Audit logs (your AUDIT format)
        if (message.includes('AUDIT') || data.audit === true) return 'audit';
        
        // Performance logs (your PERFORMANCE format)
        if (message.includes('PERFORMANCE') || data.performanceMetric === true) return 'performance';
        
        // Notification events (based on your notification system)
        if (message.includes('Processing notification')) return 'notification_start';
        if (message.includes('Notification processed')) return 'notification_processed';
        if (message.includes('Manual notification sent')) return 'notification_sent';
        
        // Error handling
        if (data.errorMessage || data.error || message.toLowerCase().includes('error')) return 'error';
        
        return 'general';
    }

    // Check if entry should be skipped based on options
    shouldSkipEntry(logEntry) {
        if (this.options.hideSocketMetrics && logEntry.type === 'socket_metrics') return true;
        if (this.options.hideServerStats && logEntry.type === 'server_stats') return true;
        return false;
    }

    // Check if we should start a new group
    shouldStartNewGroup(logEntry) {
        return logEntry.type === 'http_request' || 
               logEntry.type === 'socket_connection' || 
               logEntry.type === 'notification_start' ||
               logEntry.type === 'auth_success' ||
               (logEntry.type === 'server_stats' && this.options.groupRequests);
    }

    // Check if entry belongs to current group
    belongsToCurrentGroup(logEntry, currentGroup) {
        // Group by request ID
        if (logEntry.requestId && currentGroup.requestId === logEntry.requestId) return true;
        
        // Group by user ID for authentication flows
        if (logEntry.userId && currentGroup.userId === logEntry.userId && 
            (currentGroup.type === 'auth_success' || currentGroup.type === 'user_lookup')) return true;
        
        // Group by socket ID
        if (logEntry.socketId && currentGroup.socketId === logEntry.socketId) return true;
        
        // Group by operation ID (for notifications)
        if (logEntry.operationId && currentGroup.entries.some(e => e.operationId === logEntry.operationId)) return true;
        
        return false;
    }

    // Extract timestamp from various formats
    extractTimestamp(line) {
        // ISO timestamp
        const isoMatch = line.match(/"timestamp":"([^"]+)"/);
        if (isoMatch) return isoMatch[1];
        
        // Other timestamp formats
        const timestampMatch = line.match(/(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})/);
        return timestampMatch ? timestampMatch[1] : null;
    }

    // Extract socket ID from message
    extractSocketId(message) {
        const match = message.match(/\[Socket ID: ([^\]]+)\]/);
        return match ? match[1] : null;
    }

    // Extract log level
    extractLogLevel(line) {
        if (line.includes('"level":"error"') || line.startsWith('error:')) return 'error';
        if (line.includes('"level":"warn"') || line.startsWith('warn:')) return 'warn';
        if (line.includes('"level":"debug"') || line.startsWith('debug:')) return 'debug';
        return 'info';
    }

    // Format a group of log entries
    formatLogGroup(group) {
        const lines = [];
        
        // Group header
        const header = this.formatGroupHeader(group);
        if (header) lines.push(header);
        
        // Format each entry in the group
        for (let i = 0; i < group.entries.length; i++) {
            const entry = group.entries[i];
            const isLast = i === group.entries.length - 1;
            const formatted = this.formatLogEntry(entry, group, isLast);
            if (formatted) lines.push(formatted);
        }
        
        return lines.join('\n');
    }

    // Format group header
    formatGroupHeader(group) {
        if (!this.options.groupRequests) return null;
        
        const timestamp = this.formatTimestamp(group.startTime);
        let header = '';
        let icon = '';
        let color = 'cyan';
        
        switch (group.type) {
            case 'http_request':
                const firstEntry = group.entries[0];
                const method = firstEntry.data.method || 'HTTP';
                const path = firstEntry.data.path || '';
                icon = '🌐';
                color = 'blue';
                header = `${method} ${path}`;
                if (group.requestId) {
                    header += ` ${chalk.gray(`[${group.requestId.substring(0, 8)}...]`)}`;
                }
                break;
                
            case 'socket_connection':
                icon = '🔌';
                color = 'green';
                header = 'Socket Connection';
                if (group.socketId) {
                    header += ` ${chalk.gray(`[${group.socketId.substring(0, 8)}...]`)}`;
                }
                break;
                
            case 'notification_start':
                icon = '📨';
                color = 'yellow';
                header = 'Notification Flow';
                break;
                
            case 'auth_success':
                icon = '🔐';
                color = 'magenta';
                header = 'Authentication';
                if (group.userId) {
                    header += ` ${chalk.gray(`[${group.userId.substring(0, 8)}...]`)}`;
                }
                break;
                
            case 'server_stats':
                if (this.options.compactMode) return null;
                icon = '📊';
                color = 'blue';
                header = 'Server Statistics';
                break;
                
            default:
                return null;
        }
        
        const coloredHeader = this.options.colorize ? chalk[color].bold(header) : header;
        const prefix = this.options.colorize ? chalk.cyan('┌─') : '┌─';
        
        let result = `${prefix} ${icon} ${coloredHeader}`;
        
        if (timestamp && this.options.showTimestamps) {
            const timeStr = this.options.colorize ? chalk.gray(`(${timestamp})`) : `(${timestamp})`;
            result += ` ${timeStr}`;
        }
        
        return result;
    }

    // Format individual log entry
    formatLogEntry(entry, group = null, isLast = false) {
        if (entry.type === 'raw') {
            return this.formatRawLine(entry.content);
        }

        const lines = [];
        const prefix = this.getEntryPrefix(entry, group, isLast);
        const timestamp = this.formatTimestamp(entry.timestamp);
        const level = this.formatLogLevel(entry.level);
        
        // Main message line
        let mainLine = prefix;
        if (level && !this.options.compactMode) mainLine += level + ' ';
        if (timestamp && this.options.showTimestamps && !group) {
            const timeStr = this.options.colorize ? chalk.gray(timestamp) : timestamp;
            mainLine += `${timeStr} `;
        }
        mainLine += this.formatMessage(entry);
        
        lines.push(mainLine);
        
        // Additional data (only show relevant fields)
        if (!this.options.compactMode && this.shouldShowAdditionalData(entry)) {
            const dataLines = this.formatDataObject(entry.data, prefix + '  ');
            lines.push(...dataLines);
        }
        
        return lines.join('\n');
    }

    // Get prefix for entry (tree structure)
    getEntryPrefix(entry, group, isLast) {
        if (!group || !this.options.groupRequests) return '';
        
        if (group.entries.length === 1) {
            return this.options.colorize ? chalk.cyan('└─ ') : '└─ ';
        }
        
        return isLast ? 
            (this.options.colorize ? chalk.cyan('└─ ') : '└─ ') : 
            (this.options.colorize ? chalk.cyan('├─ ') : '├─ ');
    }

    // Format message based on type with your server's specific patterns
    formatMessage(entry) {
        const { type, message, data } = entry;
        
        switch (type) {
            case 'server_stats':
                const memory = data.memoryUsage;
                const uptime = Math.round(data.uptime / 60);
                const memoryStr = memory ? this.formatBytes(memory.heapUsed) : 'N/A';
                const text = `Server Stats: ${data.activeConnections} connections, ${memoryStr} heap, ${uptime}m uptime`;
                return this.options.colorize ? chalk.blue(text) : text;
                
            case 'socket_metrics':
                const text2 = `Socket.IO: ${data.connected} connected, ${data.metrics?.authenticated || 0} authenticated`;
                return this.options.colorize ? chalk.magenta(text2) : text2;
                
            case 'http_request':
                const statusColor = this.getStatusColor(data.statusCode);
                const methodStr = this.options.colorize ? chalk.bold(data.method) : data.method;
                const statusStr = this.options.colorize ? 
                    chalk[statusColor](data.statusCode || 'pending') : 
                    (data.statusCode || 'pending');
                return `${methodStr} ${data.path} ${statusStr} ${data.duration || ''}`;
                
            case 'auth_success':
                const userId = data.userId?.substring(0, 8) || 'unknown';
                const ip = data.clientIp || data.ip || 'unknown';
                const text3 = `✓ Auth Success: ${userId}... from ${ip}`;
                return this.options.colorize ? chalk.green(text3) : text3;
                
            case 'socket_connection':
                const userName = data.userName || 'User';
                const userIdShort = data.userId?.substring(0, 8) || 'unknown';
                const userIp = data.ip || 'unknown';
                const text4 = `🔌 Connection: ${userName} (${userIdShort}...) from ${userIp}`;
                return this.options.colorize ? chalk.green(text4) : text4;
                
            case 'notification_start':
                const recipientId = data.recipientId?.substring(0, 8) || 'unknown';
                const text5 = `📨 Notification: Processing for ${recipientId}...`;
                return this.options.colorize ? chalk.yellow(text5) : text5;
                
            case 'notification_processed':
                const text6 = `✅ Completed: ${data.success} success, ${data.failed} failed`;
                return this.options.colorize ? chalk.green(text6) : text6;
                
            case 'performance':
                const duration = data.duration || 'unknown';
                const operation = data.operation || 'operation';
                const perfColor = this.getPerfColor(duration);
                const text7 = `⚡ Performance: ${operation} took ${duration}`;
                return this.options.colorize ? chalk[perfColor](text7) : text7;
                
            case 'audit':
                const action = data.action || 'unknown';
                const auditUserId = data.userId?.substring(0, 8) || 'unknown';
                const text8 = `🔍 Audit: ${action} by ${auditUserId}...`;
                return this.options.colorize ? chalk.cyan(text8) : text8;
                
            case 'error':
                const errorMsg = data.errorMessage || data.error || message;
                return this.options.colorize ? chalk.red(`❌ Error: ${errorMsg}`) : `❌ Error: ${errorMsg}`;
                
            default:
                const cleanMessage = message.replace(/^info:\s*/, '');
                return this.options.colorize ? chalk.white(cleanMessage) : cleanMessage;
        }
    }

    // Check if we should show additional data for this entry type
    shouldShowAdditionalData(entry) {
        const typesToShowData = ['http_request', 'error', 'audit', 'performance'];
        return typesToShowData.includes(entry.type);
    }

    // Format data object (show only relevant fields)
    formatDataObject(data, prefix = '') {
        const lines = [];
        const filteredData = this.filterDataForDisplay(data);
        
        if (Object.keys(filteredData).length === 0) return lines;
        
        for (const [key, value] of Object.entries(filteredData)) {
            const formattedValue = this.formatValue(value);
            const keyStr = this.options.colorize ? chalk.gray(key + ':') : key + ':';
            lines.push(`${prefix}${keyStr} ${formattedValue}`);
        }
        
        return lines;
    }

    // Filter data to show only relevant fields
    filterDataForDisplay(data) {
        const filtered = { ...data };
        
        // Remove fields that are already shown in the message
        const fieldsToRemove = [
            'timestamp', 'level', 'requestId', 'method', 'path', 
            'statusCode', 'duration', 'userId', 'ip', 'clientIp',
            'socketId', 'userName', 'audit', 'performanceMetric',
            'success', 'failed', 'recipientId', 'action', 'operation'
        ];
        
        fieldsToRemove.forEach(field => delete filtered[field]);
        
        // Simplify complex objects
        if (filtered.memoryUsage) {
            filtered.memory = this.formatBytes(filtered.memoryUsage.heapUsed);
            delete filtered.memoryUsage;
        }
        
        // Remove empty objects
        Object.keys(filtered).forEach(key => {
            if (typeof filtered[key] === 'object' && 
                filtered[key] !== null && 
                Object.keys(filtered[key]).length === 0) {
                delete filtered[key];
            }
        });
        
        return filtered;
    }

    // Format individual values
    formatValue(value) {
        if (typeof value === 'string' && value.includes('[REDACTED]')) {
            return this.options.colorize ? chalk.red('[REDACTED]') : '[REDACTED]';
        }
        if (typeof value === 'boolean') {
            const color = value ? 'green' : 'red';
            return this.options.colorize ? chalk[color](value.toString()) : value.toString();
        }
        if (typeof value === 'number') {
            return this.options.colorize ? chalk.cyan(value.toString()) : value.toString();
        }
        if (typeof value === 'object' && value !== null) {
            return JSON.stringify(value, null, 2);
        }
        return value.toString();
    }

    // Utility methods
    formatTimestamp(timestamp) {
        if (!timestamp) return null;
        const date = new Date(timestamp);
        return date.toLocaleTimeString('en-US', { hour12: false, timeZone: 'UTC' });
    }

    formatLogLevel(level) {
        const colors = {
            error: 'red',
            warn: 'yellow',
            info: 'blue',
            debug: 'gray'
        };
        const color = colors[level] || 'white';
        const levelStr = level.toUpperCase().padEnd(5);
        return this.options.colorize ? chalk[color](levelStr) : levelStr;
    }

    formatBytes(bytes) {
        if (!bytes) return '0 B';
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(1024));
        return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
    }

    getStatusColor(statusCode) {
        if (!statusCode) return 'gray';
        if (statusCode < 300) return 'green';
        if (statusCode < 400) return 'yellow';
        return 'red';
    }

    getPerfColor(duration) {
        if (typeof duration === 'string' && duration.includes('ms')) {
            const ms = parseInt(duration);
            if (ms > 5000) return 'red';
            if (ms > 1000) return 'yellow';
        }
        return 'green';
    }

    formatRawLine(line) {
        const prefix = this.options.colorize ? chalk.gray('│ ') : '│ ';
        return prefix + line;
    }
}

// CLI Interface
function main() {
    const args = process.argv.slice(2);
    
    if (args.length === 0 || args.includes('--help')) {
        console.log(`
VortexHive Log Beautifier
Usage: node vortex-log-beautifier.js <log-file> [options]

Options:
  --no-color              Disable colored output
  --no-timestamps         Hide timestamps
  --no-group              Disable request grouping
  --compact               Enable compact mode
  --no-memory             Hide memory usage details
  --hide-socket-metrics   Hide Socket.IO metrics
  --hide-server-stats     Hide server statistics
  --help                  Show this help message

Examples:
  node vortex-log-beautifier.js logs/application-2025-06-10.log
  node vortex-log-beautifier.js logs/application-2025-06-10.log --compact
  node vortex-log-beautifier.js logs/error-2025-06-10.log --no-color
  
  # Real-time log monitoring
  tail -f logs/application-2025-06-10.log | node vortex-log-beautifier.js /dev/stdin
`);
        return;
    }

    const logFile = args[0];
    const options = {
        colorize: !args.includes('--no-color'),
        showTimestamps: !args.includes('--no-timestamps'),
        groupRequests: !args.includes('--no-group'),
        compactMode: args.includes('--compact'),
        showMemoryUsage: !args.includes('--no-memory'),
        hideSocketMetrics: args.includes('--hide-socket-metrics'),
        hideServerStats: args.includes('--hide-server-stats')
    };

    if (logFile === '/dev/stdin') {
        // Handle piped input for real-time monitoring
        let buffer = '';
        process.stdin.setEncoding('utf8');
        
        process.stdin.on('data', (chunk) => {
            buffer += chunk;
            const lines = buffer.split('\n');
            buffer = lines.pop(); // Keep incomplete line in buffer
            
            if (lines.length > 0) {
                const beautifier = new VortexHiveLogBeautifier(options);
                const beautified = beautifier.parse(lines.join('\n'));
                if (beautified.trim()) {
                    console.log(beautified);
                }
            }
        });
        
        process.stdin.on('end', () => {
            if (buffer.trim()) {
                const beautifier = new VortexHiveLogBeautifier(options);
                const beautified = beautifier.parse(buffer);
                if (beautified.trim()) {
                    console.log(beautified);
                }
            }
        });
        
        return;
    }

    if (!fs.existsSync(logFile)) {
        console.error(`Error: File '${logFile}' not found.`);
        process.exit(1);
    }

    try {
        const logContent = fs.readFileSync(logFile, 'utf8');
        const beautifier = new VortexHiveLogBeautifier(options);
        const beautifiedContent = beautifier.parse(logContent);
        console.log(beautifiedContent);
    } catch (error) {
        console.error('Error processing log file:', error.message);
        process.exit(1);
    }
}

// Export for use as module
if (require.main === module) {
    main();
} else {
    module.exports = VortexHiveLogBeautifier;
}