class GameUI {
    constructor() {
        this.game = new Game();
        this.selectedCards = new Set();
        this.bindEvents();
        this.game.onStateChange = (event, data, game) => this.handleEvent(event, data, game);
    }

    bindEvents() {
        document.getElementById('btn-start').addEventListener('click', () => this.startGame());
        document.getElementById('btn-play').addEventListener('click', () => this.humanPlay());
        document.getElementById('btn-pass').addEventListener('click', () => this.humanPass());
        document.getElementById('btn-hint').addEventListener('click', () => this.humanHint());
        document.getElementById('btn-auto').addEventListener('click', () => this.toggleAuto());
        document.getElementById('btn-tribute-confirm').addEventListener('click', () => this.confirmTribute());
        document.getElementById('btn-return-confirm').addEventListener('click', () => this.confirmReturn());
        document.getElementById('btn-restart').addEventListener('click', () => this.restart());
    }

    startGame() {
        document.getElementById('start-screen').classList.add('hidden');
        this.game.startGame();
        this.render();
    }

    restart() {
        document.getElementById('result-modal').classList.add('hidden');
        this.selectedCards.clear();
        let prevGameCount = this.game.gameCount;
        let prevTeam0Level = this.game.team0Level;
        let prevTeam1Level = this.game.team1Level;
        let prevWinnerTeam = this.game.previousWinnerTeam;
        let prevLoserTeam = this.game.previousLoserTeam;
        let wasAuto = this.game.players[0].isAuto;

        this.game = new Game();
        this.game.gameCount = prevGameCount;
        this.game.team0Level = prevTeam0Level;
        this.game.team1Level = prevTeam1Level;
        this.game.previousWinnerTeam = prevWinnerTeam;
        this.game.previousLoserTeam = prevLoserTeam;
        this.game.players[0].isAuto = wasAuto;
        for (let i = 0; i < 4; i++) {
            this.game.players[i].level = i % 2 === 0 ? prevTeam0Level : prevTeam1Level;
        }
        this.game.onStateChange = (event, data, game) => this.handleEvent(event, data, game);
        this.game.startGame();
        this.render();
    }

    render() {
        this.renderHands();
        this.renderPlayedCards();
        this.renderPlayerInfo();
        this.renderGameInfo();
        this.updateButtons();
    }

    renderHands() {
        this.renderMyHand();
        this.renderOpponentHand('player1-hand', this.game.players[1]);
        this.renderOpponentHand('player2-hand', this.game.players[2]);
        this.renderOpponentHand('player3-hand', this.game.players[3]);
    }

    renderMyHand() {
        let container = document.getElementById('player0-hand');
        container.innerHTML = '';
        let hand = this.game.players[0].hand;
        for (let card of hand) {
            let el = this.createCardElement(card, true);
            if (this.selectedCards.has(card.id)) {
                el.classList.add('selected');
            }
            el.addEventListener('click', () => this.toggleCard(card));
            container.appendChild(el);
        }
    }

    renderOpponentHand(containerId, player) {
        let container = document.getElementById(containerId);
        container.innerHTML = '';
        for (let i = 0; i < player.hand.length; i++) {
            let back = document.createElement('div');
            back.className = 'card-back';
            container.appendChild(back);
        }
    }

    createCardElement(card, full) {
        let el = document.createElement('div');
        el.className = 'card';
        el.dataset.id = card.id;

        if (card.rank === 16) {
            el.classList.add('joker-small');
            el.innerHTML = '<span class="card-rank">小</span><span class="card-suit">王</span>';
        } else if (card.rank === 17) {
            el.classList.add('joker-big');
            el.innerHTML = '<span class="card-rank">大</span><span class="card-suit">王</span>';
        } else {
            el.style.color = card.color;
            let suitSymbol = SUIT_SYMBOLS[card.suit] || '';
            el.innerHTML = `<span class="card-rank">${RANK_NAMES[card.rank]}</span><span class="card-suit">${suitSymbol}</span>`;
        }
        return el;
    }

    renderPlayedCards() {
        for (let i = 0; i < 4; i++) {
            let zone = document.getElementById(`player${i}-played`);
            zone.innerHTML = '';

            let player = this.game.players[i];
            let label = document.createElement('div');
            label.className = 'played-label';
            label.textContent = player.name;
            zone.appendChild(label);

            if (player.lastPlayedCards && player.lastPlayedCards.length > 0) {
                for (let card of player.lastPlayedCards) {
                    let el = this.createCardElement(card);
                    zone.appendChild(el);
                }
            } else if (player.passed && this.game.gamePhase === 'playing') {
                let passLabel = document.createElement('div');
                passLabel.className = 'pass-label';
                passLabel.textContent = '过';
                zone.appendChild(passLabel);
            }
        }
    }

    renderPlayerInfo() {
        let names = ['我', '左家', '对家', '右家'];
        for (let i = 0; i < 4; i++) {
            let el = document.getElementById(`player${i}-info`);
            let player = this.game.players[i];
            let isActive = this.game.currentPlayer === i && this.game.gamePhase === 'playing';
            el.className = 'player-info' + (isActive ? ' active' : '');

            let autoTag = player.isAuto ? ' [托管]' : '';
            let countTag = ` (${player.hand.length}张)`;
            let levelTag = ` 打${RANK_NAMES[player.level]}`;
            el.innerHTML = `${names[i]}${autoTag}${countTag}${levelTag}`;
        }
    }

    renderGameInfo() {
        let roundInfo = document.getElementById('round-info');
        let levelInfo = document.getElementById('current-level-info');

        if (this.game.gamePhase === 'playing') {
            let current = this.game.players[this.game.currentPlayer];
            roundInfo.textContent = `当前出牌: ${current.name}`;
            levelInfo.textContent = `我方打 ${RANK_NAMES[this.game.team0Level]} | 对方打 ${RANK_NAMES[this.game.team1Level]} | 本局级牌: ${RANK_NAMES[this.game.currentLevelRank]}`;
        } else if (this.game.gamePhase === 'tribute') {
            roundInfo.textContent = '进贡阶段';
            levelInfo.textContent = '';
        } else if (this.game.gamePhase === 'return') {
            roundInfo.textContent = '还贡阶段';
            levelInfo.textContent = '';
        } else {
            roundInfo.textContent = '';
            levelInfo.textContent = '';
        }
    }

    updateButtons() {
        let isMyTurn = this.game.currentPlayer === 0 && this.game.gamePhase === 'playing' && this.game.waitingForHuman;
        let canPlay = this.selectedCards.size > 0;
        let canPass = this.game.lastPlayedInfo && this.game.lastPlayedBy !== 0;

        document.getElementById('btn-play').disabled = !(isMyTurn && canPlay);
        document.getElementById('btn-pass').disabled = !(isMyTurn && canPass);
        document.getElementById('btn-hint').disabled = !isMyTurn;

        let autoBtn = document.getElementById('btn-auto');
        if (this.game.players[0].isAuto) {
            autoBtn.classList.add('active');
            autoBtn.textContent = '取消托管';
        } else {
            autoBtn.classList.remove('active');
            autoBtn.textContent = '托管';
        }
    }

    toggleCard(card) {
        if (this.game.gamePhase !== 'playing' && this.game.gamePhase !== 'tribute' && this.game.gamePhase !== 'return') return;
        if (!this.game.waitingForHuman && this.game.gamePhase === 'playing') return;

        if (this.selectedCards.has(card.id)) {
            this.selectedCards.delete(card.id);
        } else {
            this.selectedCards.add(card.id);
        }
        this.renderMyHand();
        this.updateButtons();
    }

    humanPlay() {
        if (!this.game.waitingForHuman) return;
        let cards = this.game.players[0].hand.filter(c => this.selectedCards.has(c.id));
        if (cards.length === 0) return;

        let info = identifyType(cards);
        if (info.type === CARD_TYPE.INVALID) {
            this.showToast('无效牌型');
            return;
        }

        if (this.game.lastPlayedInfo && this.game.lastPlayedBy !== 0) {
            if (!canBeat(info, this.game.lastPlayedInfo)) {
                this.showToast('管不上');
                return;
            }
        }

        this.selectedCards.clear();
        this.game.waitingForHuman = false;
        this.game.playCards(0, cards);
    }

    humanPass() {
        if (!this.game.waitingForHuman) return;
        this.selectedCards.clear();
        this.game.waitingForHuman = false;
        this.game.pass(0);
    }

    humanHint() {
        if (!this.game.waitingForHuman) return;
        let hint = this.game.getHint(0);
        if (hint) {
            this.selectedCards.clear();
            for (let c of hint) {
                this.selectedCards.add(c.id);
            }
            this.renderMyHand();
            this.updateButtons();
        } else {
            this.showToast('没有能管上的牌');
        }
    }

    toggleAuto() {
        let player = this.game.players[0];
        player.isAuto = !player.isAuto;

        if (player.isAuto && this.game.waitingForHuman) {
            this.selectedCards.clear();
            this.game.waitingForHuman = false;
            this.game.aiPlay(0);
        }

        this.render();
    }

    handleEvent(event, data, game) {
        switch (event) {
            case 'tribute':
                this.handleTribute(data);
                break;
            case 'return':
                this.handleReturn(data);
                break;
            case 'tribute-done':
                this.handleTributeDone(data);
                break;
            case 'return-done':
                this.handleReturnDone(data);
                break;
            case 'start-playing':
                this.showToast(`开始出牌`);
                break;
            case 'turn':
                this.render();
                break;
            case 'waiting-for-human':
                this.render();
                break;
            case 'played':
                this.handlePlayed(data);
                break;
            case 'pass':
                this.render();
                break;
            case 'first-out':
                this.showToast(`${game.players[data.player].name} 先出完！`);
                this.render();
                break;
            case 'game-over':
                this.handleGameOver(data);
                break;
        }
    }

    handleTribute(data) {
        this.showToast(`${data.fromName} 向 ${data.toName} 进贡`);
        if (data.from === 0) {
            this.showTributeModal();
        } else {
            setTimeout(() => {
                let hand = this.game.players[data.from].hand;
                let worstCard = hand[hand.length - 1];
                this.game.doTribute(worstCard.id);
            }, 1000);
        }
    }

    showTributeModal() {
        let modal = document.getElementById('tribute-modal');
        modal.classList.remove('hidden');
        let container = document.getElementById('tribute-cards');
        container.innerHTML = '';
        let hand = this.game.players[0].hand;

        for (let card of hand) {
            if (card.rank === 16 || card.rank === 17) continue;
            let el = this.createCardElement(card);
            el.addEventListener('click', () => {
                container.querySelectorAll('.card').forEach(c => c.classList.remove('selected'));
                el.classList.add('selected');
                this.tributeCardId = card.id;
                document.getElementById('btn-tribute-confirm').disabled = false;
            });
            container.appendChild(el);
        }

        this.tributeCardId = null;
        document.getElementById('btn-tribute-confirm').disabled = true;
    }

    confirmTribute() {
        if (this.tributeCardId) {
            document.getElementById('tribute-modal').classList.add('hidden');
            this.game.doTribute(this.tributeCardId);
        }
    }

    handleReturn(data) {
        this.showToast(`${data.fromName} 向 ${data.toName} 还贡`);
        if (data.from === 0) {
            this.showReturnModal();
        } else {
            setTimeout(() => {
                let hand = this.game.players[data.from].hand;
                let bestCard = hand[0];
                this.game.doReturn(bestCard.id);
            }, 1000);
        }
    }

    showReturnModal() {
        let modal = document.getElementById('return-modal');
        modal.classList.remove('hidden');
        let container = document.getElementById('return-cards');
        container.innerHTML = '';
        let hand = this.game.players[0].hand;

        for (let card of hand) {
            let el = this.createCardElement(card);
            el.addEventListener('click', () => {
                container.querySelectorAll('.card').forEach(c => c.classList.remove('selected'));
                el.classList.add('selected');
                this.returnCardId = card.id;
                document.getElementById('btn-return-confirm').disabled = false;
            });
            container.appendChild(el);
        }

        this.returnCardId = null;
        document.getElementById('btn-return-confirm').disabled = true;
    }

    confirmReturn() {
        if (this.returnCardId) {
            document.getElementById('return-modal').classList.add('hidden');
            this.game.doReturn(this.returnCardId);
        }
    }

    handleTributeDone(data) {
        this.render();
    }

    handleReturnDone(data) {
        this.render();
    }

    handlePlayed(data) {
        let typeName = TYPE_NAMES[data.type] || '出牌';
        let playerName = this.game.players[data.player].name;
        if (data.player !== 0) {
            this.showToast(`${playerName}: ${typeName}`);
        }
        this.render();
    }

    handleGameOver(data) {
        let modal = document.getElementById('result-modal');
        modal.classList.remove('hidden');

        document.getElementById('result-title').textContent = data.winnerTeam === 0 ? '恭喜获胜！' : '遗憾落败';
        document.getElementById('result-desc').innerHTML = `
            <p>${data.winnerName}获胜</p>
            <p>升级: <span class="highlight">${data.levels}级</span></p>
            <p>我方等级: <span class="highlight">${RANK_NAMES[data.team0Level]}</span> | 对方等级: <span class="highlight">${RANK_NAMES[data.team1Level]}</span></p>
        `;
    }

    showToast(msg) {
        let toast = document.createElement('div');
        toast.className = 'toast';
        toast.textContent = msg;
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 2000);
    }
}

let ui = new GameUI();
