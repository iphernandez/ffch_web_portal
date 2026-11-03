import * as readline from 'readline';
import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';
import { WhatsAppHandler } from './whatsappHandler.js';
import { FileHandler } from './fileHandler.js';
import { DateHandler } from './dateHandler.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workspaceRoot = path.resolve(__dirname, '..');
const cliHelpPath = path.join(__dirname, 'CLI_HELP.md');
const scoreFilePath = path.join(workspaceRoot, 'puntuacion.json');
const defaultProfileKey = 'FFCH';
const testProfileKey = 'TEST';
const defaultPuntaje = 3;

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
});

function prompt(question) {
    return new Promise((resolve) => rl.question(question, resolve));
}

function renderMarkdownForConsole(markdown) {
    const lines = markdown.split(/\r?\n/);
    const rendered = [];
    let inCodeBlock = false;

    for (const line of lines) {
        const trimmed = line.trim();

        if (trimmed.startsWith('```')) {
            inCodeBlock = !inCodeBlock;
            if (!inCodeBlock) {
                rendered.push('');
            }
            continue;
        }

        if (inCodeBlock) {
            rendered.push(line);
            continue;
        }

        if (trimmed.startsWith('#')) {
            rendered.push(trimmed.replace(/^#+\s*/, ''));
            rendered.push('');
            continue;
        }

        rendered.push(line.replace(/`([^`]+)`/g, '$1'));
    }

    return rendered.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function loadCliHelp() {
    if (!fs.existsSync(cliHelpPath)) {
        return 'Help file not found.';
    }

    return renderMarkdownForConsole(fs.readFileSync(cliHelpPath, 'utf8'));
}

function readRequiredTextFile(filePath, label) {
    if (!fs.existsSync(filePath)) {
        throw new Error(`${label} not found: ${filePath}`);
    }

    return fs.readFileSync(filePath, 'utf8');
}

function loadProfileConfig(profileKey = defaultProfileKey) {
    const configPath = path.join(workspaceRoot, 'config.json');

    const rootConfig = JSON.parse(readRequiredTextFile(configPath, 'Config file'));
    const profileConfig = rootConfig[profileKey];

    if (!profileConfig) {
        throw new Error(
            `Config profile "${profileKey}" was not found in config.json. Available profiles: ${Object.keys(rootConfig).join(', ')}`
        );
    }

    return {
        configPath,
        rootConfig,
        profileConfig,
        profileKey,
    };
}

function getNextThursday(baseDate = new Date()) {
    const date = new Date(baseDate);
    date.setHours(0, 0, 0, 0);

    const thursdayIndex = 4;
    const currentDay = date.getDay();
    const daysUntilThursday = (thursdayIndex - currentDay + 7) % 7;

    date.setDate(date.getDate() + daysUntilThursday);
    return date;
}

function formatDateForMessage(date) {
    return date.toLocaleDateString('es-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
    });
}

function renderTemplate(template, variables) {
    return template.replace(/\{\{\s*([A-Z0-9_]+)\s*\}\}/g, (match, key) => {
        if (Object.prototype.hasOwnProperty.call(variables, key)) {
            return String(variables[key]);
        }
        return match;
    });
}

function parseOptions(optionsRaw) {
    if (Array.isArray(optionsRaw)) {
        return optionsRaw.map((opt) => String(opt).trim()).filter(Boolean);
    }

    return String(optionsRaw || '')
        .split(',')
        .map((opt) => opt.trim())
        .filter(Boolean);
}

function parseBooleanFlag(value) {
    return String(value || '').trim().toLowerCase() === 'y';
}

function formatErrorDetails(error) {
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

function normalizeLookupText(value) {
    return String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()
        .toLowerCase();
}

function normalizeLookupNumber(value) {
    return String(value || '').trim();
}

function loadScoreEntries() {
    const scoreData = JSON.parse(readRequiredTextFile(scoreFilePath, 'Score file'));
    const entries = Array.isArray(scoreData.puntuacion) ? scoreData.puntuacion : [];

    return {
        scoreData,
        entries,
    };
}

function findScoreEntry(entries, voter) {
    const normalizedName = normalizeLookupText(voter.name);
    const normalizedNumber = normalizeLookupNumber(voter.number);

    return entries.find((entry) => {
        const matchesName =
            normalizedName && normalizeLookupText(entry.wanombre) === normalizedName;
        const matchesNumber =
            normalizedNumber && normalizeLookupNumber(entry.wanumber) === normalizedNumber;

        return matchesName || matchesNumber;
    });
}

function persistMissingScoreEntries(scoreData, missingEntries) {
    if (missingEntries.length === 0) {
        return;
    }

    if (!Array.isArray(scoreData.puntuacion)) {
        scoreData.puntuacion = [];
    }

    scoreData.puntuacion.push(...missingEntries);
    fs.writeFileSync(scoreFilePath, `${JSON.stringify(scoreData, null, 4)}\n`, 'utf8');
}

function getConfiguredSeasons(config) {
    const seasons = Array.isArray(config.seasons) ? config.seasons : [];

    if (seasons.length === 0) {
        throw new Error('No seasons were found in config.json under "seasons".');
    }

    return seasons;
}

function resolveSeasonIndex(config, requestedSeason) {
    const seasons = getConfiguredSeasons(config);

    let seasonToFind = requestedSeason;
    if (!seasonToFind && config.default) {
        seasonToFind = config.default;
    }

    if (!seasonToFind) {
        return 0;
    }

    const seasonIndex = seasons.findIndex(
        (item) => String(item.season).toLowerCase() === String(seasonToFind).toLowerCase()
    );

    if (seasonIndex < 0) {
        throw new Error(
            `Season "${seasonToFind}" not found. Available seasons: ${seasons
                .map((item) => item.season)
                .join(', ')}`
        );
    }

    return seasonIndex;
}

function isDateInSeasonRange(dateStr, startDateStr, endDateStr) {
    const [playMonth, playDay] = dateStr.split('-').map(Number);
    const [startMonth, startDay] = startDateStr.split('-').map(Number);
    const [endMonth, endDay] = endDateStr.split('-').map(Number);

    if (startMonth < endMonth) {
        // Normal range (within same year, e.g., 04-01 to 09-30)
        if (playMonth < startMonth || playMonth > endMonth) {
            return false;
        }
        if (playMonth === startMonth && playDay < startDay) {
            return false;
        }
        if (playMonth === endMonth && playDay > endDay) {
            return false;
        }
        return true;
    } else if (startMonth > endMonth) {
        // Wrapped range (e.g., 10-01 to 03-31)
        // Match if: (month >= startMonth) OR (month <= endMonth)
        if (playMonth > startMonth || playMonth < endMonth) {
            return true;
        }
        if (playMonth === startMonth && playDay >= startDay) {
            return true;
        }
        if (playMonth === endMonth && playDay <= endDay) {
            return true;
        }
        return false;
    } else {
        // startMonth === endMonth (entire month range)
        if (playMonth !== startMonth) {
            return false;
        }
        if (playDay < startDay || playDay > endDay) {
            return false;
        }
        return true;
    }
}

function resolveSeasonByDate(config, playDate) {
    const seasons = getConfiguredSeasons(config);

    const month = String(playDate.getMonth() + 1).padStart(2, '0');
    const day = String(playDate.getDate()).padStart(2, '0');
    const dateStr = `${month}-${day}`;

    const matchingSeason = seasons.find((season) => {
        const startDate = String(season.startDate || '');
        const endDate = String(season.endDate || '');

        if (!startDate || !endDate) {
            return false;
        }

        return isDateInSeasonRange(dateStr, startDate, endDate);
    });

    if (!matchingSeason) {
        throw new Error(
            `No matching season found for date ${dateStr}. Check season date ranges in config.json.`
        );
    }

    return matchingSeason;
}

function resolveSeasonSelection(config, playDate, requestedSeason) {
    const seasonIndex = requestedSeason
        ? resolveSeasonIndex(config, requestedSeason)
        : getConfiguredSeasons(config).findIndex(
            (season) => season.season === resolveSeasonByDate(config, playDate).season
        );

    return {
        seasonIndex,
        season: config.seasons[seasonIndex],
    };
}

function getRulesContent() {
    const reglamentoPath = path.join(workspaceRoot, 'reglamento.md');

    if (!fs.existsSync(reglamentoPath)) {
        return null;
    }

    return fs.readFileSync(reglamentoPath, 'utf8');
}

async function runAutomatedConvocadosFlow(wsaHdl, options = {}) {
    const { profileConfig, profileKey } = loadProfileConfig(options.profileKey);

    if (!profileConfig.convocados) {
        throw new Error(`"convocados" section was not found in config.json under "${profileKey}".`);
    }

    const convocadosConfig = profileConfig.convocados;
    const messageFile = convocadosConfig.messageFile;

    if (!messageFile) {
        throw new Error(`"messageFile" was not found in config.json under "${profileKey}.convocados".`);
    }

    const messagePath = path.join(workspaceRoot, messageFile);
    const message = readRequiredTextFile(messagePath, 'Message file');
    const groupName = profileConfig.group;

    if (!groupName) {
        throw new Error(`"group" was not found in config.json under "${profileKey}".`);
    }

    console.log('\nMessage to send:\n');
    console.log(message);

    await wsaHdl.sendMessage(groupName, message);

    console.log('Automated convocados flow completed successfully.');
}

function getAutomatedConvocatoriaContext(options = {}) {
    const { configPath, rootConfig, profileConfig, profileKey } = loadProfileConfig(options.profileKey);

    if (!profileConfig.convocatoria) {
        throw new Error(`"convocatoria" section was not found in config.json under "${profileKey}".`);
    }

    const convocatoriaConfig = profileConfig.convocatoria;
    const messageFile = convocatoriaConfig.messageFile;

    if (!messageFile) {
        throw new Error(`"messageFile" was not found in config.json under "${profileKey}.convocatoria".`);
    }

    const messagePath = path.join(workspaceRoot, messageFile);

    //! For testing purposes, we can set a fixed play date. In production, this would likely be the next upcoming Thursday.
    const playDate = getNextThursday(new Date());
    const renderedDate = formatDateForMessage(playDate);
    const { seasonIndex, season } = resolveSeasonSelection(
        convocatoriaConfig,
        playDate,
        options.seasonName,
    );

    const variables = {
        DATE: renderedDate,
        TIME: season.TIME,
        LOCATION: season.LOCATION,
        LOCATION_URL: season.LOCATION_URL,
        SEASON: season.season,
        WEEK_NUMBER: season.WEEK_NUMBER,
        YELLOW_CARDS_LATE: season.YELLOW_CARDS_LATE,
        RED_CARDS_LATE: season.RED_CARDS_LATE,
        RED_CARDS_PAYMENT: season.RED_CARDS_PAYMENT,
    };

    const message = renderTemplate(readRequiredTextFile(messagePath, 'Message file'), variables);

    const groupName = profileConfig.group;
    if (!groupName) {
        throw new Error(`"group" was not found in config.json under "${profileKey}".`);
    }

    const pollConfig = convocatoriaConfig.poll || {};
    const pollQuestion = renderTemplate(String(pollConfig.question || ''), variables);
    const pollOptions = parseOptions(pollConfig.options);
    const allowMultipleAnswers = parseBooleanFlag(pollConfig.multiple_options);
    const pollAnswer = parseOptions(pollConfig.answer);

    if (!pollQuestion) {
        throw new Error('"poll.question" is required in config.json under "convocatoria".');
    }

    if (pollOptions.length < 2) {
        throw new Error('"poll.options" must include at least 2 options.');
    }

    if (pollAnswer.length === 0) {
        throw new Error('"poll.answer" must include at least one option value.');
    }

    return {
        configPath,
        rootConfig,
        profileConfig,
        profileKey,
        convocatoriaConfig,
        seasonIndex,
        season,
        playDate,
        message,
        groupName,
        pollQuestion,
        pollOptions,
        allowMultipleAnswers,
        pollAnswer,
    };
}

async function runAutomatedConvocatoriaFlow(wsaHdl, options = {}) {
    const {
        configPath,
        rootConfig,
        profileKey,
        convocatoriaConfig,
        seasonIndex,
        season,
        message,
        groupName,
        pollQuestion,
        pollOptions,
        allowMultipleAnswers,
        pollAnswer,
    } = getAutomatedConvocatoriaContext(options);

    console.log('\nMessage to send:\n');
    console.log(message);
    const rulesContent = season.INCLUDE_RULES ? getRulesContent() : null;

    if (rulesContent) {
        console.log('\nRules to send:\n');
        console.log(rulesContent);
    }
    
    console.log('\nPoll to create:');
    console.log(`Question: ${pollQuestion}`);
    console.log(`Options: ${pollOptions.join(', ')}`);
    console.log(`Allow multiple answers: ${allowMultipleAnswers ? 'yes' : 'no'}`);
    console.log(`Vote answer(s): ${pollAnswer.join(', ')}\n`);

    await wsaHdl.sendMessage(groupName, message);

    if (rulesContent) {
        await wsaHdl.sendMessage(groupName, rulesContent);
    }

    const createdPoll = await wsaHdl.createPoll(groupName, pollQuestion, pollOptions, {
        allowMultipleAnswers,
    });
    try {
        await wsaHdl.voteOnPoll(groupName, pollQuestion, pollAnswer, {
            pollMessageId: wsaHdl.getSerializedMessageId(createdPoll),
        });
    } finally {
        // The convocatoria is already published, so advance the week even if voting fails
        const currentWeekNumber = Number(convocatoriaConfig.seasons[seasonIndex].WEEK_NUMBER);
        if (!Number.isFinite(currentWeekNumber)) {
            throw new Error(
                `WEEK_NUMBER for season "${season.season}" is not a valid number.`
            );
        }

        convocatoriaConfig.seasons[seasonIndex].WEEK_NUMBER = currentWeekNumber + 1;
        fs.writeFileSync(configPath, `${JSON.stringify(rootConfig, null, 4)}\n`, 'utf8');
        console.log(
            `Updated config.json: profile "${profileKey}", season "${season.season}" WEEK_NUMBER is now ${convocatoriaConfig.seasons[seasonIndex].WEEK_NUMBER}.`
        );
    }

    console.log('Automated convocatoria flow completed successfully.');
}

async function runAutomatedPollVotesFlow(wsaHdl, options = {}) {
    const { playDate, groupName, pollQuestion, pollAnswer } = getAutomatedConvocatoriaContext(options);
    const pollQuestionToLookup = String(options.pollQuestion || '').trim() || pollQuestion;
    const yesOption = pollAnswer[0] || 'Sí';
    const voters = await wsaHdl.getPollOptionVoters(groupName, pollQuestionToLookup, yesOption);
    const { scoreData, entries } = loadScoreEntries();
    const missingEntries = [];

    console.log('\nPoll lookup details:');
    console.log(`Play date: ${formatDateForMessage(playDate)}`);
    console.log(`Poll: ${pollQuestionToLookup}`);
    console.log(`Option: ${yesOption}`);

    console.log('\nVotes:');
    if (voters.length === 0) {
        console.log('No voters found.');
        return;
    }

    for (const voter of voters) {
        const matchedEntry = findScoreEntry(entries, voter);

        if (matchedEntry) {
            console.log(`- ${matchedEntry.nombre} (${matchedEntry.puntaje})`);
            continue;
        }

        const newEntry = {
            nombre: voter.name,
            wanombre: voter.name,
            wanumber: voter.number,
            puntaje: defaultPuntaje,
        };

        entries.push(newEntry);
        missingEntries.push(newEntry);
        console.log(`- ${voter.name} (${defaultPuntaje})`);
    }

    persistMissingScoreEntries(scoreData, missingEntries);

    if (missingEntries.length > 0) {
        console.log(`\nAdded ${missingEntries.length} voter(s) to puntuacion.json with default puntaje ${defaultPuntaje}.`);
    }
}

async function runAutomatedGroupMembersFlow(wsaHdl, options = {}) {
    const { profileConfig, profileKey } = loadProfileConfig(options.profileKey);
    const groupName = profileConfig.group;

    if (!groupName) {
        throw new Error(`"group" was not found in config.json under "${profileKey}".`);
    }

    const members = await wsaHdl.getGroupParticipants(groupName);
    printGroupMembers(groupName, members);
}

function printGroupMembers(groupName, members) {
    console.log(`\nMembers of "${groupName}" (${members.length}):`);
    for (const member of members) {
        console.log(`- ${member.name} (${member.number})${member.isAdmin ? ' [admin]' : ''}`);
    }
}

function parseCliArgs(argv) {
    const args = {
        auto: false,
        help: false,
        test: false,
        type: 'convocatoria',
        seasonName: null,
        pollQuestion: null,
    };

    for (let i = 2; i < argv.length; i += 1) {
        const arg = argv[i];

        if (arg === '--help' || arg === '-h') {
            args.help = true;
        } else if (arg === '--auto') {
            args.auto = true;
        } else if (arg === '--test') {
            args.test = true;
        } else if (arg === '--type' && i + 1 < argv.length) {
            args.type = argv[i + 1];
            i += 1;
        } else if (arg === '--season' && i + 1 < argv.length) {
            args.seasonName = argv[i + 1];
            i += 1;
        } else if (arg === '--poll-question' && i + 1 < argv.length) {
            args.pollQuestion = argv[i + 1];
            i += 1;
        }
    }

    return args;
}

async function sendMessageFlow(wsaHdl) {
    const groupName = await prompt('Enter group name: ');
    const useTemplate = await prompt('Use message template file? (y/n): ');

    let message;
    if (useTemplate.toLowerCase() === 'y') {
        const flHdl = new FileHandler();
        const dtHdl = new DateHandler();

        const weekDateIndex = 4;
        const initialSeasonDate = new Date(2023, 11, 14);
        const horaDeJuego = '8:00pm';
        const today = new Date(new Date().setHours(0, 0, 0, 0));

        let inicioTemporadaAA = initialSeasonDate.getFullYear();
        let diaDeJuego = dtHdl.getExpectedDate(today, weekDateIndex);
        let semanaTemporada = dtHdl.weekDifference(initialSeasonDate, diaDeJuego, weekDateIndex);
        let finTemporadaAA = diaDeJuego.getFullYear();

        let varObject = {
            groupName: groupName,
            diaDeJuego: diaDeJuego.toDateString(),
            horaDeJuego: horaDeJuego,
            inicioTemporadaAA: inicioTemporadaAA.toString(),
            finTemporadaAA: finTemporadaAA.toString(),
            semanaTemporada: semanaTemporada.toString(),
        };

        const templateFile = await prompt('Enter template file path (default: ../message.txt): ');
        let rawMessage = flHdl.readFileToText(templateFile.trim() || '../message.txt');
        message = flHdl.replaceVar(rawMessage, varObject);
    } else {
        message = await prompt('Enter message: ');
    }

    console.log(`\nMessage to send:\n${message}\n`);
    await wsaHdl.sendMessage(groupName, message);
}

async function sendPictureFlow(wsaHdl) {
    const groupName = await prompt('Enter group name: ');
    const filePath = await prompt('Enter image file path: ');
    const caption = await prompt('Enter caption (or press Enter to skip): ');

    const flHdl = new FileHandler();
    const resolvedPath = flHdl.resolvePath(filePath);

    if (!flHdl.fileExists(resolvedPath)) {
        console.error(`File not found: ${resolvedPath}`);
        return;
    }

    await wsaHdl.sendPicture(groupName, resolvedPath, caption);
}

async function createPollFlow(wsaHdl) {
    const groupName = await prompt('Enter group name: ');
    const pollName = await prompt('Enter poll question: ');
    const optionsRaw = await prompt('Enter poll options (comma-separated): ');
    const allowMultiple = await prompt('Allow multiple answers? (y/n): ');

    const pollOptions = parseOptions(optionsRaw);

    if (pollOptions.length < 2) {
        console.error('A poll needs at least 2 options.');
        return;
    }

    await wsaHdl.createPoll(groupName, pollName, pollOptions, {
        allowMultipleAnswers: allowMultiple.toLowerCase() === 'y',
    });
}

async function voteOnPollFlow(wsaHdl) {
    const groupName = await prompt('Enter group name: ');
    const pollName = await prompt('Enter poll question to vote on: ');
    const selectedRaw = await prompt('Enter your vote(s) (comma-separated option text): ');

    const selectedOptions = parseOptions(selectedRaw);

    if (selectedOptions.length === 0) {
        console.error('You must select at least one option.');
        return;
    }

    await wsaHdl.voteOnPoll(groupName, pollName, selectedOptions);
}

async function getPollVotersFlow(wsaHdl) {
    const groupName = await prompt('Enter group name: ');
    const pollName = await prompt('Enter poll question: ');
    const optionText = await prompt('Enter option to get voters for: ');

    const voters = await wsaHdl.getPollOptionVoters(groupName, pollName, optionText);

    if (voters.length === 0) {
        console.log('No voters found for that option.');
        return;
    }

    console.log(`\nVoters for "${optionText}":`);
    for (const voter of voters) {
        console.log(`- ${voter.name} (${voter.number})`);
    }
}

async function getGroupMembersFlow(wsaHdl) {
    const groupName = await prompt('Enter group name: ');
    const members = await wsaHdl.getGroupParticipants(groupName);
    printGroupMembers(groupName, members);
}

function showMenu() {
    console.log('\n========================================');
    console.log('  WhatsApp Group Chat - Web.js App');
    console.log('========================================');
    console.log('  1. Send a message');
    console.log('  2. Send a picture');
    console.log('  3. Create a poll');
    console.log('  4. Vote on a poll');
    console.log('  5. Get poll voters');
    console.log('  6. Get group members');
    console.log('  7. Exit');
    console.log('========================================\n');
}

async function main() {
    const args = parseCliArgs(process.argv);
    const profileKey = args.test ? testProfileKey : defaultProfileKey;

    if (args.help) {
        console.log(loadCliHelp());
        rl.close();
        return;
    }

    const wsaHdl = new WhatsAppHandler();

    console.log('Initializing WhatsApp client...');
    await wsaHdl.initialize();
    await new Promise((resolve) => setTimeout(resolve, 5000));

    if (args.auto) {
        try {
            if (args.type === 'convocados') {
                await runAutomatedConvocadosFlow(wsaHdl, {
                    profileKey,
                });
            } else if (args.type === 'convocatoria') {
                await runAutomatedConvocatoriaFlow(wsaHdl, {
                    profileKey,
                    seasonName: args.seasonName,
                });
            } else if (args.type === 'poll-votes') {
                await runAutomatedPollVotesFlow(wsaHdl, {
                    profileKey,
                    seasonName: args.seasonName,
                    pollQuestion: args.pollQuestion,
                });
            } else if (args.type === 'group-members') {
                await runAutomatedGroupMembersFlow(wsaHdl, {
                    profileKey,
                });
            } else {
                throw new Error(`Unknown type: ${args.type}. Supported types: convocados, convocatoria, poll-votes, group-members`);
            }
        } catch (error) {
            console.error(`\nError: ${formatErrorDetails(error)}`);
        } finally {
            await new Promise((resolve) => setTimeout(resolve, 3000));
            await wsaHdl.destroy();
            rl.close();
        }

        return;
    }

    let running = true;
    while (running) {
        showMenu();
        const choice = await prompt('Select an option (1-7): ');

        try {
            switch (choice.trim()) {
                case '1':
                    await sendMessageFlow(wsaHdl);
                    break;
                case '2':
                    await sendPictureFlow(wsaHdl);
                    break;
                case '3':
                    await createPollFlow(wsaHdl);
                    break;
                case '4':
                    await voteOnPollFlow(wsaHdl);
                    break;
                case '5':
                    await getPollVotersFlow(wsaHdl);
                    break;
                case '6':
                    await getGroupMembersFlow(wsaHdl);
                    break;
                case '7':
                    running = false;
                    break;
                default:
                    console.log('Invalid option. Please select 1-7.');
            }
        } catch (error) {
            console.error(`Error: ${formatErrorDetails(error)}`);
        }
    }

    await wsaHdl.destroy();
    rl.close();
    console.log('Goodbye!');
}

main();
