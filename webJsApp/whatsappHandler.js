import pkg from 'whatsapp-web.js';
const { Client, LocalAuth, MessageMedia } = pkg;
import qrcode from 'qrcode-terminal';

export class WhatsAppHandler {
    constructor() {
        this.client = new Client({
            authStrategy: new LocalAuth(),
            puppeteer: {
                headless: false,
                devtools: true,
                defaultViewport: null,
                args: [
                    '--no-first-run',
                    '--no-default-browser-check',
                    '--disable-default-apps',
                    '--disable-session-crashed-bubble',
                ],
            },
        });
        this.isReady = false;
    }

    async delay(ms) {
        await new Promise((resolve) => setTimeout(resolve, ms));
    }

    formatErrorDetails(error) {
        if (error instanceof Error) {
            return error.stack || error.message;
        }

        if (typeof error === 'string') {
            return error;
        }

        try {
            return JSON.stringify(error, null, 2);
        } catch {
            return String(error);
        }
    }

    async cleanupExtraPages() {
        const browser = this.client.pupBrowser;
        const primaryPage = this.client.pupPage;

        if (!browser || !primaryPage) {
            return;
        }

        const pages = await browser.pages();
        const extraPages = pages.filter((page) => page !== primaryPage && !page.isClosed());

        for (const page of extraPages) {
            try {
                await page.close();
            } catch {
                // Ignore startup page races while Chromium is still settling.
            }
        }
    }

    async findGroupDescriptor(groupName) {
        return this.client.pupPage.evaluate((targetGroupName) => {
            const normalize = (value) => String(value || '')
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '')
                .trim()
                .toLowerCase();

            const targetName = normalize(targetGroupName);
            const chats = window.require('WAWebCollections').Chat.getModelsArray();

            const matchedChat = chats.find((chat) => {
                if (!chat?.groupMetadata) {
                    return false;
                }

                const candidates = [chat.name, chat.formattedTitle, chat.groupMetadata?.subject];
                return candidates.some((candidate) => normalize(candidate) === targetName);
            });

            if (!matchedChat?.id?._serialized) {
                return null;
            }

            return {
                id: matchedChat.id._serialized,
                name: matchedChat.formattedTitle || matchedChat.name || matchedChat.groupMetadata?.subject || targetGroupName,
            };
        }, groupName);
    }

    async runGroupCommand(groupId, command, payload = {}) {
        return this.client.pupPage.evaluate(
            async (targetGroupId, targetCommand, targetPayload) => {
                const normalize = (value) => String(value || '')
                    .normalize('NFD')
                    .replace(/[\u0300-\u036f]/g, '')
                    .trim()
                    .toLowerCase();
                const getChatBySerializedId = (chatId) => {
                    const wid = window.require('WAWebWidFactory').createWid(chatId);

                    return (
                        window.require('WAWebCollections').Chat.get(wid) ||
                        window.require('WAWebCollections').Chat.getModelsArray().find(
                            (chat) => chat?.id?._serialized === chatId
                        )
                    );
                };

                const getRecentMessages = async (chat, limit) => {
                    const msgFilter = (msg) => !msg.isNotification;
                    let messages = chat.msgs.getModelsArray().filter(msgFilter);

                    while (messages.length < limit) {
                        const loadedMessages = await window
                            .require('WAWebChatLoadMessages')
                            .loadEarlierMsgs({ chat });

                        if (!loadedMessages || !loadedMessages.length) {
                            break;
                        }

                        messages = [...loadedMessages.filter(msgFilter), ...messages];
                    }

                    if (messages.length > limit) {
                        messages.sort((a, b) => (a.t > b.t ? 1 : -1));
                        messages = messages.splice(messages.length - limit);
                    }

                    return messages;
                };

                const chat = getChatBySerializedId(targetGroupId);
                if (!chat) {
                    throw new Error(`Group chat with id "${targetGroupId}" is not available.`);
                }

                if (targetCommand === 'sendSeen') {
                    window.require('WAWebStreamModel').Stream.markAvailable();
                    await window.require('WAWebUpdateUnreadChatAction').sendSeen({
                        chat,
                        threadId: undefined,
                    });
                    window.require('WAWebStreamModel').Stream.markUnavailable();
                    return true;
                }

                if (targetCommand === 'getParticipants') {
                    const participants = chat.groupMetadata?.participants?.getModelsArray?.() || [];
                    // Extract _serialized inside the evaluate - it's a getter dropped by JSON serialization.
                    return participants.map((participant) => ({
                        id: typeof participant.id === 'string' ? participant.id : participant.id?._serialized,
                        isAdmin: !!(participant.isAdmin || participant.isSuperAdmin),
                    }));
                }

                if (targetCommand === 'sendTextMessage') {
                    const msg = await window.WWebJS.sendMessage(chat, targetPayload.message, {
                        linkPreview: true,
                        parseVCards: true,
                    });
                    return msg ? window.WWebJS.getMessageModel(msg) : null;
                }

                if (targetCommand === 'sendMediaMessage') {
                    const msg = await window.WWebJS.sendMessage(chat, '', {
                        media: targetPayload.media,
                        caption: targetPayload.caption,
                    });
                    return msg ? window.WWebJS.getMessageModel(msg) : null;
                }

                if (targetCommand === 'createPoll') {
                    const pollOptions = (targetPayload.pollOptions || []).map((option, index) => ({
                        name: String(option || '').trim(),
                        localId: index,
                    }));

                    const msg = await window.WWebJS.sendMessage(chat, '', {
                        poll: {
                            pollName: targetPayload.pollName,
                            pollOptions,
                            options: {
                                allowMultipleAnswers: targetPayload.allowMultipleAnswers,
                            },
                        },
                    });
                    return msg ? window.WWebJS.getMessageModel(msg) : null;
                }

                if (targetCommand === 'getPollVoters') {
                    const messageLimit = Number(targetPayload.messageLimit) || 100;
                    const targetPollName = normalize(targetPayload.pollName);
                    const messages = await getRecentMessages(chat, messageLimit);

                    debugger; // Pause here for debugging in the browser console if needed
                    const pollMessage = [...messages]
                        .sort((a, b) => (a.t < b.t ? 1 : -1))
                        .find(
                            (msg) =>
                                msg.type === 'poll_creation' &&
                                normalize(msg.pollName || msg.body) === targetPollName
                        );

                    if (!pollMessage) return null;

                    // Build localId → option name map from the live message object
                    const optionMap = new Map();
                    const pollOpts = pollMessage.pollOptions || pollMessage.attributes?.pollOptions || [];
                    pollOpts.forEach((opt) => {
                        optionMap.set(opt.localId, opt.name);
                    });

                    // String(pollMessage.id) calls the live MsgKey.toString() which includes participant
                    // for group messages: "fromMe_remote_id_participant" (4 parts)
                    const rawIdStr = typeof pollMessage.id === 'string'
                        ? pollMessage.id
                        : String(pollMessage.id);
                    const serializedId = rawIdStr.includes('_') ? rawIdStr : null;
                    if (!serializedId) {
                        throw new Error(`Cannot determine ID for poll "${targetPollName}".`);
                    }

                    const WAWebMsgKey = window.require('WAWebMsgKey');
                    const table = window.require('WAWebPollsVotesSchema').getTable();
                    let rawVotes = [];

                    // WA group msg key is 4-part (includes participant); also derive 3-part (_serialized form)
                    const threePart = serializedId.split('_').slice(0, 3).join('_');

                    for (const key of [serializedId, threePart]) {
                        if (rawVotes.length) break;
                        try {
                            const mk = WAWebMsgKey.fromString(key);
                            rawVotes = await table.equals(['parentMsgKey'], mk.toString()) || [];
                        } catch {}
                        if (!rawVotes.length) {
                            try { rawVotes = await table.equals(['parentMsgKey'], key) || []; } catch {}
                        }
                        // WA internally uses pollUpdateParentKey as field name
                        if (!rawVotes.length) {
                            try { rawVotes = await table.equals(['pollUpdateParentKey'], key) || []; } catch {}
                        }
                    }

                    // Full table scan via getView_TESTONLY (bypasses index lookup)
                    if (!rawVotes.length) {
                        try {
                            const view = typeof table.getView_TESTONLY === 'function'
                                ? table.getView_TESTONLY() : null;
                            if (view && typeof view.toArray === 'function') {
                                const hexPart = threePart.split('_')[2];
                                const all = await view.toArray();
                                rawVotes = all.filter((v) => {
                                    const pk = String(v.parentMsgKey ?? v.pollUpdateParentKey ?? '');
                                    return pk.includes(hexPart);
                                });
                                if (!rawVotes.length && all.length > 0) {
                                    // Show structure of first record so we know the real field/key format
                                    throw new Error(
                                        `Table has ${all.length} record(s) but none match hexPart="${hexPart}". ` +
                                        `keys=[${Object.keys(all[0]).join(',')}] ` +
                                        `parentMsgKey="${String(all[0]?.parentMsgKey ?? '').slice(0, 100)}"`
                                    );
                                }
                            }
                        } catch (e) {
                            if (String(e.message).startsWith('Table has')) throw e;
                        }
                    }

                    if (!rawVotes.length) return [];

                    return rawVotes.map((vote) => {
                        const localIds = Array.from(new Uint8Array(vote.selectedOptionLocalIds));
                        const selectedOptions = localIds.map((id) => optionMap.get(id) || '');
                        const voter = vote.sender?._serialized ?? String(vote.sender ?? '');
                        return { voter, selectedOptions };
                    });
                }

                if (targetCommand === 'findPollMessage') {
                    const messageLimit = Number(targetPayload.messageLimit) || 50;
                    const targetPollName = normalize(targetPayload.pollName);
                    const messages = await getRecentMessages(chat, messageLimit);

                    const pollMessage = [...messages]
                        .sort((a, b) => (a.t < b.t ? 1 : -1))
                        .find(
                            (msg) =>
                                msg.type === 'poll_creation' &&
                                normalize(msg.pollName || msg.body) === targetPollName
                        );

                    if (!pollMessage) return null;
                    const model = window.WWebJS.getMessageModel(pollMessage);
                    // _serialized is a getter on WA's MsgKey and is dropped by JSON serialization
                    if (model?.id && typeof model.id === 'object') {
                        const rawId = pollMessage.id;
                        let serialized = typeof rawId === 'string'
                            ? rawId
                            : rawId?._serialized;
                        if (!serialized && rawId?.fromMe !== undefined && rawId?.remote && rawId?.id) {
                            const remote = typeof rawId.remote === 'object' ? rawId.remote._serialized : rawId.remote;
                            serialized = `${rawId.fromMe}_${remote}_${rawId.id}`;
                        }
                        model.id._serialized = serialized;
                    }
                    return model;
                }

                throw new Error(`Unsupported group command: ${targetCommand}`);
            },
            groupId,
            command,
            payload,
        );
    }

    async ensureChatReady(group) {
        await this.runGroupCommand(group.id, 'sendSeen');
        await this.delay(2000);
    }

    async getReadyGroup(groupName) {
        const group = await this.findGroup(groupName);
        await this.ensureChatReady(group);
        return group;
    }

    async findPollMessage(group, pollName, messageLimit = 50) {
        return this.runGroupCommand(group.id, 'findPollMessage', {
            pollName,
            messageLimit,
        });
    }

    async voteOnMessage(messageId, selectedOptions) {
        await this.applyMsgKeyCompatShim();
        await this.client.pupPage.evaluate(
            async (targetMessageId, votes) => {
                if (!targetMessageId) {
                    return null;
                }

                const selectedVotes = Array.isArray(votes) ? votes : [votes];
                const localIdSet = new Set();
                const { Msg, Chat } = window.require('WAWebCollections');
                const [, remote, hexId] = String(targetMessageId).split('_');
                // Group messages are keyed by a 4-part id (with participant), so a 3-part id may miss
                const matchesHex = (m) => hexId && (m?.id?.id === hexId || String(m?.id || '').split('_')[2] === hexId);
                let msg = Msg.get(targetMessageId);

                if (!msg) {
                    try {
                        msg = (await Msg.getMessagesById([targetMessageId]))?.messages?.[0];
                    } catch {}
                }
                if (!msg) {
                    msg = Msg.getModelsArray().find(matchesHex);
                }
                if (!msg && remote) {
                    const chat = Chat.getModelsArray().find((c) => c?.id?._serialized === remote);
                    msg = chat?.msgs?.getModelsArray().find(matchesHex);
                }

                if (!msg) {
                    throw new Error(`Poll message "${targetMessageId}" could not be loaded.`);
                }

                msg.pollOptions.forEach((option) => {
                    for (const vote of selectedVotes) {
                        if (option.name === vote) {
                            localIdSet.add(option.localId);
                        }
                    }
                });

                await window
                    .require('WAWebPollsSendVoteMsgAction')
                    .sendVote(msg, localIdSet);
            },
            messageId,
            selectedOptions,
        );
    }

    normalizeText(value) {
        return String(value || '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .trim()
            .toLowerCase();
    }

    getSerializedMessageId(message) {
        if (!message) {
            return null;
        }

        if (typeof message.id === 'string') {
            return message.id;
        }

        if (message.id && typeof message.id._serialized === 'string') {
            return message.id._serialized;
        }

        if (message.id && typeof message.id.$1 === 'string') {
            return message.id.$1;
        }

        if (typeof message._serialized === 'string') {
            return message._serialized;
        }

        return null;
    }

    async resolveVoterContact(voterRef) {
        if (!voterRef) {
            return null;
        }

        if (typeof voterRef === 'string') {
            try {
                return await this.client.getContactById(voterRef);
            } catch {
                return null;
            }
        }

        if (typeof voterRef.getContact === 'function') {
            try {
                return await voterRef.getContact();
            } catch {
                return null;
            }
        }

        return null;
    }

    /**
     * WhatsApp Web renamed MsgKey's serialized id from `_serialized` to `$1`.
     * whatsapp-web.js <= 1.34.7 still reads `_serialized` (e.g. in its poll vote
     * hook), which makes poll votes fail with "Vote send error". Restore
     * `_serialized` as a read-only alias of `$1` until the library ships the fix.
     * @returns {Promise<void>}
     */
    async applyMsgKeyCompatShim() {
        await this.client.pupPage.evaluate(() => {
            const MsgKey = window.require('WAWebMsgKey');
            const proto = MsgKey?.prototype;
            if (!proto || '_serialized' in proto) {
                return;
            }

            Object.defineProperty(proto, '_serialized', {
                configurable: true,
                get() {
                    return this.$1 ?? this.toString();
                },
            });
        });
    }

    /**
     * Initialize the WhatsApp client, display QR code, and wait until ready.
     * @returns {Promise<void>}
     */
    async initialize() {
        return new Promise((resolve, reject) => {
            this.client.on('qr', (qr) => {
                console.log('Scan the QR code below to log in:');
                qrcode.generate(qr, { small: true });
            });

            this.client.on('authenticated', () => {
                console.log('Authenticated successfully.');
            });

            this.client.on('auth_failure', (msg) => {
                console.error('Authentication failure:', msg);
                reject(new Error('Authentication failed'));
            });

            this.client.on('ready', () => {
                console.log('WhatsApp client is ready!');
                this.isReady = true;
                this.applyMsgKeyCompatShim()
                    .then(() => this.cleanupExtraPages())
                    .catch(() => {})
                    .finally(resolve);
            });

            this.client.initialize();
        });
    }

    /**
     * Find a WhatsApp group chat by its name, retrying a few times to allow
     * chats to finish syncing after the client becomes ready.
     * @param {string} groupName - The name of the group to find.
     * @param {number} [retries=5] - Number of attempts before giving up.
     * @param {number} [delayMs=3000] - Milliseconds to wait between attempts.
     * @returns {Promise<object>} The group chat object.
     */
    async findGroup(groupName, retries = 5, delayMs = 3000) {
        for (let attempt = 1; attempt <= retries; attempt++) {
            const group = await this.findGroupDescriptor(groupName);

            if (group) {
                console.log(`Found group: "${group.name}" (${group.id})`);
                return group;
            }

            if (attempt < retries) {
                console.log(`Group "${groupName}" not found yet, retrying in ${delayMs / 1000}s... (${attempt}/${retries})`);
                await this.delay(delayMs);
            }
        }

        throw new Error(`Group "${groupName}" not found after ${retries} attempts.`);
    }

    /**
     * Send a text message to a WhatsApp group.
     * @param {string} groupName - The target group name.
     * @param {string} message - The message text to send.
     * @returns {Promise<void>}
     */
    async sendMessage(groupName, message) {
        const group = await this.getReadyGroup(groupName);

        try {
            await this.runGroupCommand(group.id, 'sendTextMessage', { message });
        } catch (error) {
            console.error(`Failed to send message to group "${groupName}":`);
            console.error(this.formatErrorDetails(error));
            throw error;
        }

        await this.delay(3000);
        console.log(`Message sent to group "${groupName}".`);
    }

    /**
     * Send a picture (image file) to a WhatsApp group, with an optional caption.
     * @param {string} groupName - The target group name.
     * @param {string} filePath - The path to the image file.
     * @param {string} [caption=''] - Optional caption for the image.
     * @returns {Promise<void>}
     */
    async sendPicture(groupName, filePath, caption = '') {
        const group = await this.getReadyGroup(groupName);
        const media = MessageMedia.fromFilePath(filePath);
        await this.runGroupCommand(group.id, 'sendMediaMessage', { media, caption });
        await this.delay(3000);
        console.log(`Picture "${filePath}" sent to group "${groupName}".`);
    }

    /**
     * Create a poll in a WhatsApp group.
     * @param {string} groupName - The target group name.
     * @param {string} pollName - The poll question/title.
     * @param {string[]} pollOptions - Array of poll option strings.
     * @param {object} [options] - Optional poll settings.
     * @param {boolean} [options.allowMultipleAnswers=false] - Whether multiple answers are allowed.
     * @returns {Promise<object>} The sent message object.
     */
    async createPoll(groupName, pollName, pollOptions, options = {}) {
        const group = await this.getReadyGroup(groupName);
        const { allowMultipleAnswers = false } = options;

        const sentMessage = await this.runGroupCommand(group.id, 'createPoll', {
            pollName,
            pollOptions,
            allowMultipleAnswers,
        });
        await this.delay(3000);
        console.log(`Poll "${pollName}" created in group "${groupName}".`);
        return sentMessage;
    }

    /**
     * Vote on a poll in a WhatsApp group.
     * If a poll message id is provided, it is used directly. Otherwise,
     * the method searches recent messages by poll title with retries.
     * @param {string} groupName - The target group name.
     * @param {string} pollName - The poll question/title to search for.
     * @param {string[]} selectedOptions - Array of option strings to vote for.
     * @param {object} [options] - Optional vote settings.
     * @param {string} [options.pollMessageId] - Specific poll message id to vote on.
     * @param {number} [options.retries=5] - Lookup attempts when pollMessageId is not provided.
     * @param {number} [options.delayMs=2000] - Delay between lookup attempts.
     * @param {number} [options.messageLimit=100] - Number of recent messages to scan.
     * @returns {Promise<void>}
     */
    async voteOnPoll(groupName, pollName, selectedOptions, options = {}) {
        const {
            pollMessageId = null,
            retries = 5,
            delayMs = 2000,
            messageLimit = 100,
        } = options;

        const group = await this.getReadyGroup(groupName);
        let targetMessageId = String(pollMessageId || '').trim();

        if (!targetMessageId) {
            let pollMessage = null;

            for (let attempt = 1; attempt <= retries; attempt += 1) {
                pollMessage = await this.findPollMessage(group, pollName, messageLimit);

                if (pollMessage) {
                    targetMessageId = this.getSerializedMessageId(pollMessage) || '';
                    if (targetMessageId) {
                        break;
                    }
                }

                if (attempt < retries) {
                    console.log(
                        `Poll "${pollName}" not found yet, retrying in ${delayMs / 1000}s... (${attempt}/${retries})`
                    );
                    await this.delay(delayMs);
                }
            }
        }

        if (!targetMessageId) {
            throw new Error(
                `Poll "${pollName}" not found in recent messages of group "${groupName}" after ${retries} attempts.`
            );
        }

        await this.voteOnMessage(targetMessageId, selectedOptions);
        console.log(
            `Voted on poll "${pollName}" with options: [${selectedOptions.join(', ')}]`
        );
    }

    /**
     * Get the list of voters for a specific option in a poll.
     * @param {string} groupName - The target group name.
     * @param {string} pollName - The poll question/title to search for.
     * @param {string} optionText - The poll option text to get voters for.
     * @returns {Promise<{ name: string, number: string }[]>} Array of voters for the specified option.
     */
    async getPollOptionVoters(groupName, pollName, optionText, options = {}) {
        const {
            retries = 5,
            delayMs = 3000,
            messageLimit = 100,
        } = options;

        const group = await this.getReadyGroup(groupName);
        let rawVotes = null;

        for (let attempt = 1; attempt <= retries; attempt += 1) {
            rawVotes = await this.runGroupCommand(group.id, 'getPollVoters', { pollName, messageLimit });
            if (rawVotes !== null) break;
            if (attempt < retries) {
                console.log(`Poll "${pollName}" not found yet, retrying in ${delayMs / 1000}s... (${attempt}/${retries})`);
                await this.delay(delayMs);
            }
        }

        if (rawVotes === null) {
            throw new Error(
                `Poll "${pollName}" not found in recent messages of group "${groupName}" after ${retries} attempts.`
            );
        }

        if (rawVotes.length === 0) {
            console.log(`No votes found for poll "${pollName}".`);
            return [];
        }

        const voters = [];
        for (const vote of rawVotes) {
            const matchedOption = (vote.selectedOptions ?? []).some(
                (name) => this.normalizeText(name) === this.normalizeText(optionText)
            );

            if (matchedOption) {
                const contact = await this.resolveVoterContact(vote.voter);
                if (contact) {
                    voters.push({
                        name: contact.pushname || contact.name || contact.number,
                        number: contact.number,
                    });
                }
            }
        }

        console.log(
            `Found ${voters.length} voter(s) for option "${optionText}" in poll "${pollName}".`
        );
        return voters;
    }

    /**
     * Get the list of members of a WhatsApp group, with their names and phone numbers.
     * @param {string} groupName - The target group name.
     * @returns {Promise<{ name: string, number: string, isAdmin: boolean }[]>} Array of group members.
     */
    async getGroupParticipants(groupName) {
        const group = await this.getReadyGroup(groupName);
        const rawParticipants = await this.runGroupCommand(group.id, 'getParticipants');

        const members = [];
        for (const participant of rawParticipants) {
            const contact = await this.resolveVoterContact(participant.id);
            members.push({
                name: contact?.pushname || contact?.name || participant.id,
                number: contact?.number || String(participant.id || '').split('@')[0],
                isAdmin: participant.isAdmin,
            });
        }

        console.log(`Found ${members.length} member(s) in group "${groupName}".`);
        return members;
    }

    /**
     * Gracefully destroy the WhatsApp client session.
     * @returns {Promise<void>}
     */
    async destroy() {
        try {
            await this.client.destroy();
            console.log('WhatsApp client session closed.');
        } catch {
            // Ignore errors during shutdown — the browser may already be closing.
            console.log('Ignore errors during shutdown — the browser may already be closing.');
        }
    }
}
