const SUITS = ['spade', 'heart', 'club', 'diamond'];
const SUIT_SYMBOLS = { spade: '♠', heart: '♥', club: '♣', diamond: '♦' };
const SUIT_COLORS = { spade: '#000', heart: '#e74c3c', club: '#000', diamond: '#e74c3c' };
const RANK_NAMES = { 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '10', 11: 'J', 12: 'Q', 13: 'K', 14: 'A', 15: '2', 16: 'S', 17: 'B' };

const CARD_TYPE = {
    INVALID: 0,
    SINGLE: 1,
    PAIR: 2,
    THREE: 3,
    THREE_WITH_TWO: 4,
    THREE_WITH_PAIR: 5,
    STRAIGHT: 6,
    PAIR_STRAIGHT: 7,
    AIRPLANE: 8,
    AIRPLANE_WITH_WINGS: 9,
    AIRPLANE_WITH_PAIRS: 10,
    FOUR_WITH_TWO: 11,
    FOUR_WITH_TWO_PAIRS: 12,
    BOMB: 13,
    ROCKET: 14,
    FOUR_BOMB: 15,
    STRAIGHT_FLUSH: 16
};

const TYPE_NAMES = {
    [CARD_TYPE.INVALID]: '无效',
    [CARD_TYPE.SINGLE]: '单张',
    [CARD_TYPE.PAIR]: '对子',
    [CARD_TYPE.THREE]: '三张',
    [CARD_TYPE.THREE_WITH_TWO]: '三带二',
    [CARD_TYPE.THREE_WITH_PAIR]: '三带一对',
    [CARD_TYPE.STRAIGHT]: '顺子',
    [CARD_TYPE.PAIR_STRAIGHT]: '连对',
    [CARD_TYPE.AIRPLANE]: '飞机',
    [CARD_TYPE.AIRPLANE_WITH_WINGS]: '飞机带翅膀',
    [CARD_TYPE.AIRPLANE_WITH_PAIRS]: '飞机带对',
    [CARD_TYPE.FOUR_WITH_TWO]: '四带二',
    [CARD_TYPE.FOUR_WITH_TWO_PAIRS]: '四带两对',
    [CARD_TYPE.BOMB]: '炸弹',
    [CARD_TYPE.ROCKET]: '火箭',
    [CARD_TYPE.FOUR_BOMB]: '四张炸弹',
    [CARD_TYPE.STRAIGHT_FLUSH]: '同花顺'
};

class Card {
    constructor(suit, rank) {
        this.suit = suit;
        this.rank = rank;
        this.id = suit + '_' + rank + '_' + Math.random().toString(36).substr(2, 5);
        this.selected = false;
    }

    get display() {
        if (this.rank === 16) return '小王';
        if (this.rank === 17) return '大王';
        return (SUIT_SYMBOLS[this.suit] || '') + RANK_NAMES[this.rank];
    }

    get color() {
        if (this.rank === 17) return '#e74c3c';
        if (this.rank === 16) return '#2c3e50';
        return SUIT_COLORS[this.suit] || '#000';
    }

    get sortKey() {
        return this.rank * 10 + SUITS.indexOf(this.suit);
    }
}

function createDeck() {
    let cards = [];
    for (let d = 0; d < 2; d++) {
        for (let suit of SUITS) {
            for (let rank = 3; rank <= 15; rank++) {
                cards.push(new Card(suit, rank));
            }
        }
        cards.push(new Card('joker', 16));
        cards.push(new Card('joker', 17));
    }
    return cards;
}

function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

function sortCards(cards) {
    return [...cards].sort((a, b) => b.sortKey - a.sortKey);
}

function getCountMap(cards) {
    let m = {};
    for (let c of cards) {
        m[c.rank] = m[c.rank] || [];
        m[c.rank].push(c);
    }
    return m;
}

function identifyType(cards) {
    if (!cards || cards.length === 0) return { type: CARD_TYPE.INVALID };

    let n = cards.length;
    let cm = getCountMap(cards);
    let ranks = Object.keys(cm).map(Number).sort((a, b) => a - b);

    if (n === 1) return { type: CARD_TYPE.SINGLE, mainRank: ranks[0] };

    if (n === 2) {
        if (ranks.length === 1 && cm[ranks[0]].length === 2) {
            return { type: CARD_TYPE.PAIR, mainRank: ranks[0] };
        }
        let sr = ranks.sort((a, b) => a - b);
        if (sr.length === 2 && sr[0] === 16 && sr[1] === 17) {
            return { type: CARD_TYPE.ROCKET, mainRank: 99 };
        }
        return { type: CARD_TYPE.INVALID };
    }

    if (n === 3) {
        if (ranks.length === 1 && cm[ranks[0]].length === 3) {
            return { type: CARD_TYPE.THREE, mainRank: ranks[0] };
        }
        return { type: CARD_TYPE.INVALID };
    }

    if (n === 4) {
        if (ranks.length === 1 && cm[ranks[0]].length === 4) {
            return { type: CARD_TYPE.FOUR_BOMB, mainRank: ranks[0] };
        }
        let threeRank = null, kickerRank = null;
        for (let r of ranks) {
            if (cm[r].length === 3) threeRank = r;
            else kickerRank = r;
        }
        if (threeRank !== null && kickerRank !== null && cm[kickerRank].length === 1) {
            return { type: CARD_TYPE.THREE_WITH_TWO, mainRank: threeRank };
        }
        let pairRanks = ranks.filter(r => cm[r].length === 2);
        if (pairRanks.length === 2 && isConsecutive(pairRanks)) {
            return { type: CARD_TYPE.PAIR_STRAIGHT, mainRank: Math.max(...pairRanks), length: 2 };
        }
        return { type: CARD_TYPE.INVALID };
    }

    if (n >= 5) {
        if (ranks.length === 1 && n >= 5) {
            return { type: CARD_TYPE.BOMB, mainRank: ranks[0], bombSize: n };
        }
        if (isConsecutive(ranks) && ranks.every(r => cm[r].length === 1) && ranks[ranks.length - 1] <= 14) {
            let suits = cards.map(c => c.suit);
            if (suits.every(s => s === suits[0]) && suits[0] !== 'joker') {
                return { type: CARD_TYPE.STRAIGHT_FLUSH, mainRank: Math.max(...ranks), length: n };
            }
            return { type: CARD_TYPE.STRAIGHT, mainRank: Math.max(...ranks), length: n };
        }
    }

    if (n === 5) {
        let threeRank = null;
        let kickers = [];
        for (let r of ranks) {
            if (cm[r].length === 3) threeRank = r;
            else if (cm[r].length === 2) kickers.push(r);
        }
        if (threeRank !== null && kickers.length === 1) {
            return { type: CARD_TYPE.THREE_WITH_PAIR, mainRank: threeRank };
        }
        return { type: CARD_TYPE.INVALID };
    }

    let pairRanks = ranks.filter(r => cm[r].length >= 2).sort((a, b) => a - b);
    if (pairRanks.length >= 3 && n === pairRanks.length * 2 && isConsecutive(pairRanks) && pairRanks[pairRanks.length - 1] <= 14) {
        return { type: CARD_TYPE.PAIR_STRAIGHT, mainRank: Math.max(...pairRanks), length: pairRanks.length };
    }

    let tripleRanks = ranks.filter(r => cm[r].length >= 3).sort((a, b) => a - b);
    let consecTriples = findConsecutiveTriples(tripleRanks, 14);
    for (let ct of consecTriples) {
        if (ct.length >= 2) {
            let tripleCount = ct.length;
            let remaining = n - tripleCount * 3;
            if (remaining === 0) {
                return { type: CARD_TYPE.AIRPLANE, mainRank: Math.max(...ct), length: tripleCount };
            }
            if (remaining === tripleCount) {
                return { type: CARD_TYPE.AIRPLANE_WITH_WINGS, mainRank: Math.max(...ct), length: tripleCount };
            }
            if (remaining === tripleCount * 2) {
                let remainCards = cards.filter(c => !ct.some(r => cm[r].slice(0, 3).includes(c)));
                let remainCm = getCountMap(remainCards);
                let remainPairs = Object.values(remainCm).filter(arr => arr.length >= 2);
                if (remainPairs.length >= tripleCount) {
                    return { type: CARD_TYPE.AIRPLANE_WITH_PAIRS, mainRank: Math.max(...ct), length: tripleCount };
                }
            }
        }
    }

    let fourRank = ranks.find(r => cm[r].length === 4);
    if (fourRank !== undefined) {
        let remaining = n - 4;
        if (remaining === 2) {
            return { type: CARD_TYPE.FOUR_WITH_TWO, mainRank: fourRank };
        }
        if (remaining === 4) {
            let remainCards = cards.filter(c => !cm[fourRank].includes(c));
            let remainCm = getCountMap(remainCards);
            let remainPairs = Object.keys(remainCm).filter(r => remainCm[r].length >= 2);
            if (remainPairs.length >= 2) {
                return { type: CARD_TYPE.FOUR_WITH_TWO_PAIRS, mainRank: fourRank };
            }
        }
    }

    return { type: CARD_TYPE.INVALID };
}

function isConsecutive(ranks) {
    if (ranks.length < 2) return false;
    let sorted = [...ranks].sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i++) {
        if (sorted[i] - sorted[i - 1] !== 1) return false;
    }
    return true;
}

function findConsecutiveTriples(tripleRanks, maxRank) {
    let filtered = tripleRanks.filter(r => r <= maxRank).sort((a, b) => a - b);
    let results = [];
    let current = [filtered[0]];
    for (let i = 1; i < filtered.length; i++) {
        if (filtered[i] - filtered[i - 1] === 1) {
            current.push(filtered[i]);
        } else {
            if (current.length >= 2) results.push([...current]);
            current = [filtered[i]];
        }
    }
    if (current.length >= 2) results.push(current);
    let originalResults = [...results];
    for (let r of originalResults) {
        for (let len = r.length; len >= 2; len--) {
            for (let start = 0; start <= r.length - len; start++) {
                let sub = r.slice(start, start + len);
                if (sub.length < r.length) results.push(sub);
            }
        }
    }
    results.sort((a, b) => b.length - a.length);
    return results;
}

function canBeat(playedInfo, lastInfo) {
    if (playedInfo.type === CARD_TYPE.INVALID) return false;
    if (playedInfo.type === CARD_TYPE.ROCKET) return true;
    if (lastInfo.type === CARD_TYPE.ROCKET) return false;

    if (playedInfo.type === CARD_TYPE.BOMB || playedInfo.type === CARD_TYPE.FOUR_BOMB) {
        if (lastInfo.type === CARD_TYPE.BOMB || lastInfo.type === CARD_TYPE.FOUR_BOMB) {
            let playedBombSize = playedInfo.bombSize || (playedInfo.type === CARD_TYPE.BOMB ? 6 : 4);
            let lastBombSize = lastInfo.bombSize || (lastInfo.type === CARD_TYPE.BOMB ? 6 : 4);
            if (playedBombSize !== lastBombSize) return playedBombSize > lastBombSize;
            return playedInfo.mainRank > lastInfo.mainRank;
        }
        return true;
    }

    if (lastInfo.type === CARD_TYPE.BOMB || lastInfo.type === CARD_TYPE.FOUR_BOMB) {
        if (playedInfo.type !== CARD_TYPE.ROCKET && playedInfo.type !== CARD_TYPE.BOMB && playedInfo.type !== CARD_TYPE.FOUR_BOMB) {
            return false;
        }
    }

    if (playedInfo.type !== lastInfo.type) return false;

    if (playedInfo.type === CARD_TYPE.STRAIGHT || playedInfo.type === CARD_TYPE.PAIR_STRAIGHT || playedInfo.type === CARD_TYPE.AIRPLANE || playedInfo.type === CARD_TYPE.AIRPLANE_WITH_WINGS || playedInfo.type === CARD_TYPE.AIRPLANE_WITH_PAIRS || playedInfo.type === CARD_TYPE.STRAIGHT_FLUSH) {
        if (playedInfo.length !== lastInfo.length) return false;
    }

    return playedInfo.mainRank > lastInfo.mainRank;
}

function isBombType(type) {
    return type === CARD_TYPE.BOMB || type === CARD_TYPE.FOUR_BOMB || type === CARD_TYPE.ROCKET || type === CARD_TYPE.STRAIGHT_FLUSH;
}

class Player {
    constructor(id, name, isHuman, level) {
        this.id = id;
        this.name = name;
        this.isHuman = isHuman;
        this.hand = [];
        this.level = level || 2;
        this.isAuto = false;
        this.lastPlayedCards = null;
        this.passed = false;
    }
}

class Game {
    constructor() {
        this.players = [
            new Player(0, '我', true, 2),
            new Player(1, '左家', false, 2),
            new Player(2, '对家', false, 2),
            new Player(3, '右家', false, 2)
        ];
        this.currentPlayer = 0;
        this.lastPlayed = null;
        this.lastPlayedBy = -1;
        this.lastPlayedInfo = null;
        this.passCount = 0;
        this.gamePhase = 'idle';
        this.roundHistory = [];
        this.winner = -1;
        this.secondWinner = -1;
        this.team0Level = 2;
        this.team1Level = 2;
        this.currentLevelRank = 2;
        this.tributePhase = false;
        this.returnPhase = false;
        this.tributeFrom = -1;
        this.tributeTo = -1;
        this.mustTribute = false;
        this.onStateChange = null;
        this.onPlayerAction = null;
        this.onGameOver = null;
        this.waitingForHuman = false;
        this.gameCount = 0;
        this.previousWinnerTeam = -1;
        this.previousLoserTeam = -1;
    }

    getPartner(playerId) {
        return (playerId + 2) % 4;
    }

    isPartner(p1, p2) {
        return this.getPartner(p1) === p2;
    }

    startGame() {
        this.gamePhase = 'dealing';
        this.gameCount++;
        this.winner = -1;
        this.secondWinner = -1;
        this.lastPlayed = null;
        this.lastPlayedBy = -1;
        this.lastPlayedInfo = null;
        this.passCount = 0;
        this.roundHistory = [];
        this.currentLevelRank = this.team0Level;

        let deck = shuffle(createDeck());
        for (let p of this.players) {
            p.hand = [];
            p.passed = false;
            p.lastPlayedCards = null;
        }

        for (let i = 0; i < deck.length; i++) {
            this.players[i % 4].hand.push(deck[i]);
        }

        for (let p of this.players) {
            p.hand = sortCards(p.hand);
        }

        if (this.gameCount === 1) {
            this.startPlaying(0);
        } else {
            this.checkTribute();
        }
    }

    checkTribute() {
        this.mustTribute = false;
        this.tributePhase = false;
        this.returnPhase = false;
        this.tributeFrom = -1;
        this.tributeTo = -1;

        if (this.previousLoserTeam === -1) {
            this.startPlaying(0);
            return;
        }

        let loserTeam = this.previousLoserTeam;
        let winnerTeam = 1 - loserTeam;

        let loser0 = loserTeam;
        let loser2 = loserTeam + 2;
        let loser0Cards = this.players[loser0].hand.length;
        let loser2Cards = this.players[loser2].hand.length;

        if (loser0Cards === 0 && loser2Cards === 0) {
            this.startPlaying(0);
            return;
        }

        let bigLoser = loser0Cards >= loser2Cards ? loser0 : loser2;
        let winner0 = winnerTeam;
        let winner2 = winnerTeam + 2;
        let winnerLessCards = this.players[winner0].hand.length <= this.players[winner2].hand.length ? winner0 : winner2;

        let bigLoserCards = Math.max(loser0Cards, loser2Cards);
        if (bigLoserCards <= 2) {
            this.startPlaying(0);
            return;
        }

        this.tributeFrom = bigLoser;
        this.tributeTo = winnerLessCards;
        this.tributePhase = true;
        this.gamePhase = 'tribute';

        this.notify('tribute', {
            from: this.tributeFrom,
            to: this.tributeTo,
            fromName: this.players[this.tributeFrom].name,
            toName: this.players[this.tributeTo].name
        });
    }

    doTribute(cardId) {
        let player = this.players[this.tributeFrom];
        let cardIndex = player.hand.findIndex(c => c.id === cardId);
        if (cardIndex === -1) return;

        let card = player.hand.splice(cardIndex, 1)[0];
        this.players[this.tributeTo].hand.push(card);

        this.notify('tribute-done', {
            from: this.tributeFrom,
            to: this.tributeTo,
            card: card
        });

        this.returnPhase = true;
        this.tributePhase = false;
        this.gamePhase = 'return';

        this.notify('return', {
            from: this.tributeTo,
            to: this.tributeFrom,
            fromName: this.players[this.tributeTo].name,
            toName: this.players[this.tributeFrom].name
        });
    }

    doReturn(cardId) {
        let player = this.players[this.tributeTo];
        let cardIndex = player.hand.findIndex(c => c.id === cardId);
        if (cardIndex === -1) return;

        let card = player.hand.splice(cardIndex, 1)[0];
        this.players[this.tributeFrom].hand.push(card);

        this.notify('return-done', {
            from: this.tributeTo,
            to: this.tributeFrom,
            card: card
        });

        this.returnPhase = false;
        this.gamePhase = 'playing';

        for (let p of this.players) {
            p.hand = sortCards(p.hand);
        }

        this.startPlaying(this.tributeTo);
    }

    startPlaying(firstPlayer) {
        this.gamePhase = 'playing';
        this.currentPlayer = firstPlayer;
        this.lastPlayed = null;
        this.lastPlayedBy = -1;
        this.lastPlayedInfo = null;
        this.passCount = 0;

        this.notify('start-playing', { firstPlayer: firstPlayer });
        this.nextTurn();
    }

    nextTurn() {
        if (this.gamePhase !== 'playing') return;

        if (this.checkGameOver()) return;

        let skipAttempts = 0;
        while (this.players[this.currentPlayer].hand.length === 0 && skipAttempts < 4) {
            this.currentPlayer = (this.currentPlayer + 1) % 4;
            skipAttempts++;
        }
        if (skipAttempts >= 4) return;

        let player = this.players[this.currentPlayer];

        if (this.passCount >= 3) {
            this.lastPlayed = null;
            this.lastPlayedBy = -1;
            this.lastPlayedInfo = null;
            this.passCount = 0;
        }

        this.notify('turn', { player: this.currentPlayer });

        if (player.isHuman && !player.isAuto) {
            this.waitingForHuman = true;
            this.notify('waiting-for-human', {});
        } else {
            this.waitingForHuman = false;
            setTimeout(() => this.aiPlay(this.currentPlayer), 800);
        }
    }

    playCards(playerId, cards) {
        if (this.gamePhase !== 'playing') return false;
        if (playerId !== this.currentPlayer) return false;

        let player = this.players[playerId];
        let info = identifyType(cards);
        if (info.type === CARD_TYPE.INVALID) return false;

        if (this.lastPlayedInfo && this.lastPlayedBy !== playerId) {
            if (!canBeat(info, this.lastPlayedInfo)) return false;
        }

        if (this.lastPlayedBy === playerId) {
            this.lastPlayed = null;
            this.lastPlayedInfo = null;
            this.passCount = 0;
        }

        for (let card of cards) {
            let idx = player.hand.findIndex(c => c.id === card.id);
            if (idx !== -1) player.hand.splice(idx, 1);
        }

        player.lastPlayedCards = cards;
        player.passed = false;

        this.lastPlayed = cards;
        this.lastPlayedBy = playerId;
        this.lastPlayedInfo = info;
        this.passCount = 0;

        if (isBombType(info.type)) {
            this.currentLevelRank = Math.min(this.currentLevelRank + (info.type === CARD_TYPE.ROCKET ? 3 : 2), 15);
        }

        this.roundHistory.push({
            player: playerId,
            cards: cards,
            type: info.type
        });

        this.notify('played', {
            player: playerId,
            cards: cards,
            type: info.type,
            typeName: TYPE_NAMES[info.type] || '出牌',
            handCount: player.hand.length
        });

        if (player.hand.length === 0) {
            if (this.winner === -1) {
                this.winner = playerId;
                this.notify('first-out', { player: playerId });
            } else if (this.secondWinner === -1 && !this.isPartner(this.winner, playerId)) {
                this.secondWinner = playerId;
            }
        }

        this.currentPlayer = (this.currentPlayer + 1) % 4;
        setTimeout(() => this.nextTurn(), 500);
        return true;
    }

    pass(playerId) {
        if (this.gamePhase !== 'playing') return false;
        if (playerId !== this.currentPlayer) return false;
        if (!this.lastPlayedInfo) return false;
        if (this.lastPlayedBy === playerId) return false;

        let player = this.players[playerId];
        player.passed = true;
        player.lastPlayedCards = null;
        this.passCount++;

        this.notify('pass', { player: playerId });

        this.currentPlayer = (this.currentPlayer + 1) % 4;
        setTimeout(() => this.nextTurn(), 500);
        return true;
    }

    checkGameOver() {
        let team0Out = this.players[0].hand.length === 0 && this.players[2].hand.length === 0;
        let team1Out = this.players[1].hand.length === 0 && this.players[3].hand.length === 0;

        if (team0Out || team1Out) {
            this.endGame(team0Out ? 0 : 1);
            return true;
        }

        return false;
    }

    endGame(winnerTeam) {
        this.gamePhase = 'ended';
        this.previousWinnerTeam = winnerTeam;
        this.previousLoserTeam = 1 - winnerTeam;
        let levels = 0;
        let firstOut = -1;
        for (let i = 0; i < 4; i++) {
            if (this.players[i].hand.length === 0 && i % 2 === winnerTeam) {
                if (firstOut === -1) firstOut = i;
            }
        }

        let loserTeam = 1 - winnerTeam;
        let loser0Cards = this.players[loserTeam].hand.length;
        let loser2Cards = this.players[loserTeam + 2].hand.length;
        let maxLoserCards = Math.max(loser0Cards, loser2Cards);

        if (maxLoserCards === 0) levels = 3;
        else if (maxLoserCards <= 5) levels = 2;
        else if (maxLoserCards <= 10) levels = 1;
        else levels = 1;

        levels += (this.currentLevelRank > 2 ? this.currentLevelRank - 2 : 0);

        if (winnerTeam === 0) {
            this.team0Level = Math.min(this.team0Level + levels, 15);
        } else {
            this.team1Level = Math.min(this.team1Level + levels, 15);
        }

        for (let p of this.players) {
            p.level = p.id % 2 === 0 ? this.team0Level : this.team1Level;
        }

        let winnerName = winnerTeam === 0 ? '我方（我和对家）' : '对方（左家和右家）';

        this.notify('game-over', {
            winnerTeam: winnerTeam,
            winnerName: winnerName,
            levels: levels,
            team0Level: this.team0Level,
            team1Level: this.team1Level
        });
    }

    aiPlay(playerId) {
        if (this.gamePhase !== 'playing') return;
        let player = this.players[playerId];
        if (player.hand.length === 0) {
            this.currentPlayer = (this.currentPlayer + 1) % 4;
            setTimeout(() => this.nextTurn(), 300);
            return;
        }

        let hand = player.hand;
        let lastInfo = this.lastPlayedInfo;
        let lastBy = this.lastPlayedBy;

        if (!lastInfo || lastBy === playerId) {
            let play = aiChooseLead(hand, this.currentLevelRank);
            if (play) {
                this.playCards(playerId, play);
            } else {
                this.playCards(playerId, [hand[hand.length - 1]]);
            }
        } else {
            let isPartnerLast = this.isPartner(playerId, lastBy);
            let play = aiChooseFollow(hand, lastInfo, isPartnerLast, this.currentLevelRank);
            if (play) {
                this.playCards(playerId, play);
            } else {
                this.pass(playerId);
            }
        }
    }

    autoPlayForPlayer(playerId) {
        this.aiPlay(playerId);
    }

    notify(event, data) {
        if (this.onStateChange) {
            this.onStateChange(event, data, this);
        }
    }

    getPlayerValidCards(playerId) {
        let hand = this.players[playerId].hand;
        if (!this.lastPlayedInfo || this.lastPlayedBy === playerId) {
            return getAllPossiblePlays(hand);
        }
        return getFollowPlays(hand, this.lastPlayedInfo);
    }

    getHint(playerId) {
        let hand = this.players[playerId].hand;
        if (!this.lastPlayedInfo || this.lastPlayedBy === playerId) {
            let plays = getAllPossiblePlays(hand);
            return plays.length > 0 ? plays[0] : null;
        }
        let plays = getFollowPlays(hand, this.lastPlayedInfo);
        return plays.length > 0 ? plays[0] : null;
    }
}

function getAllPossiblePlays(hand) {
    let plays = [];
    let cm = getCountMap(hand);
    let ranks = Object.keys(cm).map(Number).sort((a, b) => a - b);

    for (let r of ranks) {
        for (let c of cm[r]) {
            plays.push([c]);
        }
    }

    for (let r of ranks) {
        if (cm[r].length >= 2) {
            plays.push(cm[r].slice(0, 2));
        }
    }

    for (let r of ranks) {
        if (cm[r].length >= 3) {
            plays.push(cm[r].slice(0, 3));
            for (let r2 of ranks) {
                if (r2 !== r && cm[r2].length >= 1) {
                    plays.push([...cm[r].slice(0, 3), cm[r2][0]]);
                }
            }
            for (let r2 of ranks) {
                if (r2 !== r && cm[r2].length >= 2) {
                    plays.push([...cm[r].slice(0, 3), ...cm[r2].slice(0, 2)]);
                }
            }
        }
    }

    let singleRanks = ranks.filter(r => r <= 14);
    for (let len = 5; len <= singleRanks.length; len++) {
        for (let start = 0; start <= singleRanks.length - len; start++) {
            let straightRanks = singleRanks.slice(start, start + len);
            if (isConsecutive(straightRanks)) {
                let cards = straightRanks.map(r => cm[r][0]);
                plays.push(cards);
            }
        }
    }

    let pairRanks = ranks.filter(r => cm[r].length >= 2 && r <= 14).sort((a, b) => a - b);
    for (let len = 3; len <= pairRanks.length; len++) {
        for (let start = 0; start <= pairRanks.length - len; start++) {
            let seq = pairRanks.slice(start, start + len);
            if (isConsecutive(seq)) {
                let cards = seq.flatMap(r => cm[r].slice(0, 2));
                plays.push(cards);
            }
        }
    }

    for (let r of ranks) {
        if (cm[r].length === 4) {
            plays.push(cm[r].slice(0, 4));
            let kickers = ranks.filter(r2 => r2 !== r);
            if (kickers.length >= 2) {
                plays.push([...cm[r].slice(0, 4), cm[kickers[0]][0], cm[kickers[1]][0]]);
            }
        }
        if (cm[r].length >= 5) {
            plays.push(cm[r].slice(0, cm[r].length));
        }
    }

    let j16 = hand.find(c => c.rank === 16);
    let j17 = hand.find(c => c.rank === 17);
    if (j16 && j17) {
        plays.push([j16, j17]);
    }

    return plays;
}

function getFollowPlays(hand, lastInfo) {
    let plays = [];
    let cm = getCountMap(hand);
    let ranks = Object.keys(cm).map(Number).sort((a, b) => a - b);

    switch (lastInfo.type) {
        case CARD_TYPE.SINGLE:
            for (let r of ranks) {
                if (r > lastInfo.mainRank) {
                    plays.push([cm[r][0]]);
                }
            }
            break;

        case CARD_TYPE.PAIR:
            for (let r of ranks) {
                if (r > lastInfo.mainRank && cm[r].length >= 2) {
                    plays.push(cm[r].slice(0, 2));
                }
            }
            break;

        case CARD_TYPE.THREE:
            for (let r of ranks) {
                if (r > lastInfo.mainRank && cm[r].length >= 3) {
                    plays.push(cm[r].slice(0, 3));
                }
            }
            break;

        case CARD_TYPE.THREE_WITH_TWO:
            for (let r of ranks) {
                if (r > lastInfo.mainRank && cm[r].length >= 3) {
                    for (let r2 of ranks) {
                        if (r2 !== r && cm[r2].length >= 1) {
                            plays.push([...cm[r].slice(0, 3), cm[r2][0]]);
                            break;
                        }
                    }
                }
            }
            break;

        case CARD_TYPE.THREE_WITH_PAIR:
            for (let r of ranks) {
                if (r > lastInfo.mainRank && cm[r].length >= 3) {
                    for (let r2 of ranks) {
                        if (r2 !== r && cm[r2].length >= 2) {
                            plays.push([...cm[r].slice(0, 3), ...cm[r2].slice(0, 2)]);
                            break;
                        }
                    }
                }
            }
            break;

        case CARD_TYPE.STRAIGHT: {
            let len = lastInfo.length;
            let singleRanks = ranks.filter(r => r <= 14);
            for (let start = 0; start <= singleRanks.length - len; start++) {
                let seq = singleRanks.slice(start, start + len);
                if (isConsecutive(seq) && Math.max(...seq) > lastInfo.mainRank) {
                    let cards = seq.map(r => cm[r][0]);
                    plays.push(cards);
                }
            }
            break;
        }

        case CARD_TYPE.PAIR_STRAIGHT: {
            let len = lastInfo.length;
            let pairRanks = ranks.filter(r => cm[r].length >= 2 && r <= 14).sort((a, b) => a - b);
            for (let start = 0; start <= pairRanks.length - len; start++) {
                let seq = pairRanks.slice(start, start + len);
                if (isConsecutive(seq) && Math.max(...seq) > lastInfo.mainRank) {
                    let cards = seq.flatMap(r => cm[r].slice(0, 2));
                    plays.push(cards);
                }
            }
            break;
        }

        case CARD_TYPE.FOUR_BOMB:
            for (let r of ranks) {
                if (r > lastInfo.mainRank && cm[r].length === 4) {
                    plays.push(cm[r].slice(0, 4));
                }
            }
            break;

        case CARD_TYPE.FOUR_WITH_TWO:
            for (let r of ranks) {
                if (r > lastInfo.mainRank && cm[r].length === 4) {
                    let kickers = ranks.filter(r2 => r2 !== r);
                    if (kickers.length >= 2) {
                        plays.push([...cm[r], cm[kickers[0]][0], cm[kickers[1]][0]]);
                    }
                }
            }
            break;

        case CARD_TYPE.FOUR_WITH_TWO_PAIRS:
            for (let r of ranks) {
                if (r > lastInfo.mainRank && cm[r].length === 4) {
                    let pairKickers = ranks.filter(r2 => r2 !== r && cm[r2].length >= 2);
                    if (pairKickers.length >= 2) {
                        plays.push([...cm[r], ...cm[pairKickers[0]].slice(0, 2), ...cm[pairKickers[1]].slice(0, 2)]);
                    }
                }
            }
            break;

        case CARD_TYPE.BOMB: {
            for (let r of ranks) {
                if (cm[r].length >= 5) {
                    plays.push(cm[r].slice(0, cm[r].length));
                }
            }
            break;
        }

        case CARD_TYPE.AIRPLANE:
        case CARD_TYPE.AIRPLANE_WITH_WINGS:
        case CARD_TYPE.AIRPLANE_WITH_PAIRS: {
            let len = lastInfo.length;
            let tripleRanks = ranks.filter(r => cm[r].length >= 3 && r <= 14).sort((a, b) => a - b);
            for (let start = 0; start <= tripleRanks.length - len; start++) {
                let seq = tripleRanks.slice(start, start + len);
                if (isConsecutive(seq) && Math.max(...seq) > lastInfo.mainRank) {
                    let cards = seq.flatMap(r => cm[r].slice(0, 3));
                    if (lastInfo.type === CARD_TYPE.AIRPLANE) {
                        plays.push(cards);
                    } else if (lastInfo.type === CARD_TYPE.AIRPLANE_WITH_WINGS) {
                        let remainRanks = ranks.filter(r => !seq.includes(r));
                        if (remainRanks.length >= len) {
                            let wings = remainRanks.slice(0, len).map(r => cm[r][0]);
                            plays.push([...cards, ...wings]);
                        }
                    } else {
                        let remainRanks = ranks.filter(r => !seq.includes(r) && cm[r].length >= 2);
                        if (remainRanks.length >= len) {
                            let wings = remainRanks.slice(0, len).flatMap(r => cm[r].slice(0, 2));
                            plays.push([...cards, ...wings]);
                        }
                    }
                }
            }
            break;
        }
    }

    if (lastInfo.type !== CARD_TYPE.ROCKET) {
        if (lastInfo.type !== CARD_TYPE.BOMB && lastInfo.type !== CARD_TYPE.FOUR_BOMB) {
            for (let r of ranks) {
                if (cm[r].length === 4) {
                    plays.push(cm[r].slice(0, 4));
                }
            }
            for (let r of ranks) {
                if (cm[r].length >= 5) {
                    plays.push(cm[r].slice(0, cm[r].length));
                }
            }
        } else if (lastInfo.type === CARD_TYPE.FOUR_BOMB) {
            for (let r of ranks) {
                if (cm[r].length >= 5) {
                    plays.push(cm[r].slice(0, cm[r].length));
                }
            }
        }

        let j16 = hand.find(c => c.rank === 16);
        let j17 = hand.find(c => c.rank === 17);
        if (j16 && j17) {
            plays.push([j16, j17]);
        }
    }

    return plays;
}

function aiChooseLead(hand, levelRank) {
    if (hand.length === 0) return null;

    let cm = getCountMap(hand);
    let ranks = Object.keys(cm).map(Number).sort((a, b) => a - b);

    let levelCards = ranks.filter(r => r === levelRank);
    if (levelCards.length > 0 && cm[levelCards[0]].length === 1) {
        return [cm[levelCards[0]][0]];
    }

    let singleRanks = ranks.filter(r => cm[r].length === 1 && r <= 14);
    if (singleRanks.length >= 5) {
        for (let len = singleRanks.length; len >= 5; len--) {
            for (let start = 0; start <= singleRanks.length - len; start++) {
                let seq = singleRanks.slice(start, start + len);
                if (isConsecutive(seq)) {
                    return seq.map(r => cm[r][0]);
                }
            }
        }
    }

    let pairRanks = ranks.filter(r => cm[r].length === 2 && r <= 14);
    if (pairRanks.length >= 3) {
        for (let len = pairRanks.length; len >= 3; len--) {
            for (let start = 0; start <= pairRanks.length - len; start++) {
                let seq = pairRanks.slice(start, start + len);
                if (isConsecutive(seq)) {
                    return seq.flatMap(r => cm[r].slice(0, 2));
                }
            }
        }
    }

    let tripleRanks = ranks.filter(r => cm[r].length === 3);
    if (tripleRanks.length > 0) {
        let r = tripleRanks[0];
        let kickers = ranks.filter(r2 => r2 !== r);
        if (kickers.length > 0) {
            return [...cm[r].slice(0, 3), cm[kickers[0]][0]];
        }
        return cm[r].slice(0, 3);
    }

    let pairR = ranks.find(r => cm[r].length === 2);
    if (pairR !== undefined) {
        return cm[pairR].slice(0, 2);
    }

    return [hand[hand.length - 1]];
}

function aiChooseFollow(hand, lastInfo, isPartner, levelRank) {
    let plays = getFollowPlays(hand, lastInfo);

    if (plays.length === 0) return null;

    if (isPartner) {
        if (lastInfo.type === CARD_TYPE.SINGLE || lastInfo.type === CARD_TYPE.PAIR) {
            if (Math.random() < 0.7) return null;
        }
    }

    let nonBombPlays = plays.filter(p => {
        let info = identifyType(p);
        return !isBombType(info.type);
    });

    if (nonBombPlays.length > 0) {
        return nonBombPlays[0];
    }

    if (hand.length <= 4 && plays.length > 0) {
        return plays[0];
    }

    if (Math.random() < 0.3 && plays.length > 0) {
        return plays[0];
    }

    return null;
}
