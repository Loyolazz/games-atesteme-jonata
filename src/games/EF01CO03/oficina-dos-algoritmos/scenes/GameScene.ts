import Phaser from 'phaser';

import { EventBus } from '../../../../shared/EventBus';
/*
 * `runtimeGameBridge`, e não `gameBridge`: o segundo só fala com a própria página
 * (barramento local). Embutido pela Atesteme, ele deixava o jogo MUDO — a partida
 * inteira acontecia e a plataforma não recebia nem o `GAME_READY`, então o desafio
 * nunca aprovava nem reprovava. Era o único dos 46 jogos ainda na ponte antiga.
 */
import { runtimeGameBridge } from '../../../../shared/bridge/runtimeGameBridge';
import type { PlatformCommand } from '../../../../shared/contracts/platformCommands';
import { LEVELS } from '../data/levels';
import type { AlgorithmCard, AlgorithmLevel } from '../types';
import { showLevelComplete } from '../data/showLevelComplete';
import { createTutorial, type TutorialStep } from '../../../../shared/tutorial/createTutorial';

type AlgorithmStep = AlgorithmCard & {
  correctOrder: number | null;
};

const GAME_WIDTH = 960;
const GAME_HEIGHT = 540;
const GAME_ID = 'oficina-dos-algoritmos';
const CARD_WIDTH = 112;
const CARD_HEIGHT = 116;
const CARD_IMAGE_WIDTH = 88;
const CARD_IMAGE_HEIGHT = 72;
const CARD_RADIUS = 20;
const CARD_HITBOX_WIDTH = CARD_WIDTH;
const CARD_HITBOX_HEIGHT = CARD_HEIGHT;

const COLORS = {
  orange: 0xf57c00,
  blue: 0x45c6f0,
  green: 0x42d640,
  softOrange: 0xff8a2a,
  cream: 0xfff6e8,
  cyan: 0x35c5df,
};

export class GameScene extends Phaser.Scene {
  private sequenceSlots: Phaser.GameObjects.Container[] = [];
  private placedOrder: Array<number | null> = [];
  private testButton?: Phaser.GameObjects.Container;
  private testButtonBg?: Phaser.GameObjects.Graphics;
  private testButtonText?: Phaser.GameObjects.Text;
  private isTestButtonEnabled = false;
  private currentLevel: AlgorithmLevel = LEVELS[0];
  private steps: AlgorithmStep[] = [];
  private currentPoints = 0;
  private currentLives = 0;
  private hits = 0;
  private errors = 0;
  private hasCompletedLevel = false;
  private unsubscribePlatformCommands?: () => void;
  private timeBarFill?: Phaser.GameObjects.Graphics;
  private timerTween?: Phaser.Tweens.Tween;
  private timerState = { progress: 1 };
  private hasStartedTimer = false;
  private timerDuration = 30000;
  private shouldShowLevelStart = false;
  private fallbackAudioContext?: AudioContext;
  private firstCardPos: { x: number; y: number } | null = null;

  constructor() {
    super('GameScene');
  }

  init(data?: { level?: number; points?: number; lives?: number; showLevelStart?: boolean }) {
    const requestedLevel = data?.level ?? 1;
    this.currentLevel = LEVELS.find((level) => level.level === requestedLevel) ?? LEVELS[0];
    this.currentPoints = data?.points ?? this.currentPoints;
    this.currentLives = data?.lives ?? this.currentLives;
    this.hits = 0;
    this.errors = 0;
    this.hasCompletedLevel = false;
    this.hasStartedTimer = false;
    this.shouldShowLevelStart = data?.showLevelStart ?? false;
    this.timerDuration = this.currentLevel.timeLimit * 1000;

    const expectedOrder = new Map(
      this.currentLevel.correctOrder.map((id, index) => [id, index + 1])
    );
    this.steps = [
      ...this.currentLevel.cards,
      ...(this.currentLevel.distractors ?? []),
    ].map((card) => ({
      ...card,
      correctOrder: expectedOrder.get(card.id) ?? null,
    }));
    this.placedOrder = this.currentLevel.correctOrder.map(() => null);
    this.sequenceSlots = [];
    this.firstCardPos = null;
  }

  create() {
    this.createBackground();
    this.createTimeBar();
    this.createTitle();
    this.createSequencePanel();
    this.createSequenceSlots();
    this.createCardsArea();
    this.createCards();
    this.createButton();
    this.registerDragEvents();
    this.registerPlatformCommands();
    this.emitReady();
    this.emitCheckpoint();

    if (this.shouldShowLevelStart && this.currentLevel.level > 1) {
      this.showNextLevelStartScreen();
      return;
    }

    if (this.currentLevel.level === 1) {
      this.runTutorial();
    }
  }

  private runTutorial() {
    const lvl = this.currentLevel.level;
    const firstSlot = this.sequenceSlots[0];
    const firstCard = this.firstCardPos;
    const cardsY = lvl === 1 ? 378 : 366;
    const slotsY = lvl === 1 ? 214 : 202;
    const buttonY = lvl === 1 ? 478 : 486;
    const cardCount = this.steps.length;
    const slotCount = this.currentLevel.correctOrder.length;
    const cardAreaW = lvl === 1 ? 440 : cardCount <= 6 ? 880 : 940;
    const slotAreaW = lvl === 1 ? 540 : slotCount === 5 ? 780 : 850;

    const steps: TutorialStep[] = [];

    if (lvl === 1) {
      steps.push(
        {
          text: 'Arraste os cartoes de baixo.',
          shape: 'rect',
          x: 480,
          y: cardsY,
          w: cardAreaW,
          h: 150,
          balloonX: 480,
          balloonY: 150,
        },
        {
          text: 'Solte nos espacos 1, 2 e 3.',
          shape: 'rect',
          x: 480,
          y: slotsY,
          w: slotAreaW,
          h: 150,
          balloonX: 480,
          balloonY: 360,
          pointer: firstCard && firstSlot
            ? { fromX: firstCard.x, fromY: firstCard.y, toX: firstSlot.x, toY: firstSlot.y }
            : undefined,
        },
        {
          text: 'Tudo pronto? Toque em testar.',
          shape: 'rect',
          x: 480,
          y: buttonY,
          w: 320,
          h: 80,
          balloonX: 480,
          balloonY: 260,
          buttonLabel: 'Comecar',
        },
      );
    } else if (lvl === 2) {
      steps.push(
        {
          text: 'Monte so os passos certos.',
          shape: 'rect',
          x: 480,
          y: cardsY,
          w: cardAreaW,
          h: 150,
          balloonX: 480,
          balloonY: 150,
        },
        {
          text: 'Um cartao nao entra na sequencia.',
          shape: 'rect',
          x: 480,
          y: slotsY,
          w: slotAreaW,
          h: 150,
          balloonX: 480,
          balloonY: 350,
          buttonLabel: 'Entendi',
        },
      );
    } else if (lvl === 3) {
      steps.push(
        {
          text: 'Escolha os seis passos corretos.',
          shape: 'rect',
          x: 480,
          y: cardsY,
          w: cardAreaW,
          h: 150,
          balloonX: 480,
          balloonY: 150,
        },
        {
          text: 'Deixe os intrusos fora.',
          shape: 'rect',
          x: 480,
          y: slotsY,
          w: slotAreaW,
          h: 150,
          balloonX: 480,
          balloonY: 350,
          buttonLabel: 'Entendi',
        },
      );
    }

    if (!steps.length) return;

    createTutorial(this, {
      key: `algoritmos-l${lvl}`,
      accent: COLORS.softOrange,
      safeTop: 16,
      onFinish: () => { /* cartoes ja ficam livres assim que a tutorial fecha */ },
      steps,
    });
  }
  private createBackground() {
    const backgroundKey =
      this.currentLevel.level === 2
        ? 'bg-03-level-2'
        : this.currentLevel.level === 3
          ? 'bg-03-level-3'
          : 'bg-03';
    const bg = this.add.image(GAME_WIDTH / 2, GAME_HEIGHT / 2, backgroundKey);
    this.coverImage(bg, GAME_WIDTH, GAME_HEIGHT);
    bg.setDepth(0);

    const overlay = this.add.graphics();
    overlay.fillStyle(0xffffff, 0.05);
    overlay.fillRoundedRect(0, 0, GAME_WIDTH, GAME_HEIGHT, 28);
    overlay.setDepth(1);
  }

  private createTimeBar() {
    const x = 210;
    const y = this.currentLevel.level === 1 ? 22 : 16;
    const width = 540;
    const height = 24;

    const bg = this.add.graphics();
    bg.fillStyle(0xdff2bc, 1);
    bg.fillRoundedRect(x, y, width, height, 12);
    bg.setDepth(6);

    this.timeBarFill = this.add.graphics();
    this.timeBarFill.setData('barX', x);
    this.timeBarFill.setData('barY', y);
    this.timeBarFill.setData('barWidth', width);
    this.timeBarFill.setData('barHeight', height);
    this.timeBarFill.setDepth(7);

    this.drawTimeBar(1);
  }

  private drawTimeBar(progress: number) {
    if (!this.timeBarFill) return;

    const x = this.timeBarFill.getData('barX') as number;
    const y = this.timeBarFill.getData('barY') as number;
    const barWidth = this.timeBarFill.getData('barWidth') as number;
    const barHeight = this.timeBarFill.getData('barHeight') as number;
    const width = barWidth * Phaser.Math.Clamp(progress, 0, 1);

    this.timeBarFill.clear();
    this.timeBarFill.fillStyle(0x7ed321, 1);
    this.timeBarFill.fillRoundedRect(x, y, width, barHeight, barHeight / 2);
  }

  private startTimer() {
    if (this.hasStartedTimer) return;

    this.hasStartedTimer = true;
    this.timerState.progress = 1;
    this.drawTimeBar(1);

    this.timerTween = this.tweens.add({
      targets: this.timerState,
      progress: 0,
      duration: this.timerDuration,
      ease: 'Linear',
      onUpdate: () => this.drawTimeBar(this.timerState.progress),
      onComplete: () => {
        this.drawTimeBar(0);
        this.errors += 1;
        this.perderVida();
        this.emitWrongAnswer();
        this.emitCheckpoint();
        this.showFeedback('Tempo esgotado!', false);
      },
    });
  }

  private createTitle() {
    const isLevelOne = this.currentLevel.level === 1;

    this.add
      .text(480, isLevelOne ? 80 : 58, this.currentLevel.title, {
        fontFamily: 'DynaPuff, Arial, sans-serif',
        fontSize: '30px',
        fontStyle: 'bold',
        color: '#ffffff',
        stroke: '#1b2559',
        strokeThickness: 4,
        shadow: {
          offsetX: 0,
          offsetY: 2,
          color: '#2d2d7a',
          blur: 0,
          fill: true,
        },
      })
      .setOrigin(0.5)
      .setResolution(2)
      .setDepth(10);

    this.add
      .text(480, isLevelOne ? 112 : 84, this.currentLevel.objective, {
        fontFamily: 'DynaPuff, Arial, sans-serif',
        fontSize: '15px',
        fontStyle: 'bold',
        color: '#ffffff',
        stroke: '#1b2559',
        strokeThickness: 3,
        shadow: {
          offsetX: 0,
          offsetY: 1,
          color: '#2d2d7a',
          blur: 0,
          fill: true,
        },
      })
      .setOrigin(0.5)
      .setResolution(2)
      .setDepth(10);
  }

 private createSequencePanel() {
  const shadow = this.add.graphics();
  shadow.fillStyle(0x000000, 0.14);

  const slotCount = this.currentLevel.correctOrder.length;
  const isLevelOne = this.currentLevel.level === 1;
  const panelWidth = isLevelOne ? 508 : slotCount === 5 ? 760 : 820;
  const panelX = isLevelOne ? 220 : 480 - panelWidth / 2;
  const panelY = isLevelOne ? 130 : 118;
  const shadowY = isLevelOne ? 138 : 126;
  const panelHeight = 150;
  const labelY = isLevelOne ? 145 : 134;

  shadow.fillRoundedRect(panelX + 6, shadowY, panelWidth, panelHeight, 22);

  shadow.setDepth(6);

  const panel = this.add.graphics();

  panel.fillStyle(0xffffff, 0.48);

  panel.fillRoundedRect(panelX, panelY, panelWidth + 12, panelHeight, 22);

  panel.lineStyle(3, 0xffffff, 0.75);

  panel.strokeRoundedRect(panelX, panelY, panelWidth + 12, panelHeight, 22);

  panel.setDepth(7);

  this.add
    .text(480, labelY, 'Sequência', {
      fontFamily: 'DynaPuff, Arial, sans-serif',
      fontSize: '17px',
      fontStyle: 'bold',
      color: '#25327a',

      shadow: {
        offsetX: 0,
        offsetY: 1,
        color: '#ffffff',
        blur: 0,
        fill: true,
      },
    })
    .setOrigin(0.5)
    .setResolution(2)
    .setDepth(10);
}

  private createSequenceSlots() {
    const count = this.currentLevel.correctOrder.length;
    const isLevelOne = this.currentLevel.level === 1;
    const spacing = count <= 3 ? 130 : count === 5 ? 140 : 124;
    const startX = 480 - ((count - 1) * spacing) / 2;
    const colors = [COLORS.blue, COLORS.green, COLORS.softOrange, COLORS.cyan, COLORS.orange, 0xa78bfa];
    const y = isLevelOne ? 214 : 202;

    for (let index = 0; index < count; index += 1) {
      this.sequenceSlots.push(
        this.createSlot(startX + index * spacing, y, colors[index % colors.length], String(index + 1))
      );
    }
  }

  private createSlot(x: number, y: number, color: number, label: string) {
    const container = this.add.container(x, y);
    container.setDepth(9);

    const bg = this.add.image(0, 0, 'slot');
    bg.texture.setFilter(Phaser.Textures.FilterMode.LINEAR);
    bg.setDisplaySize(CARD_WIDTH, CARD_HEIGHT);
    bg.setAlpha(0.98);

    const number = this.add
      .text(0, 0, label, {
        fontFamily: 'DynaPuff, Arial, sans-serif',
        fontSize: '42px',
        fontStyle: 'bold',
        color: '#ffffff',
        stroke: '#1b2559',
        strokeThickness: 4,
        shadow: {
          offsetX: 0,
          offsetY: 2,
          color: '#3b3b8f',
          blur: 0,
          fill: true,
        },
      })
      .setOrigin(0.5)
      .setResolution(2);

    container.add([bg, number]);
    return container;
  }

  private createCardsArea() {
    const shadow = this.add.graphics();
    shadow.fillStyle(0x000000, 0.14);

    const totalCards = this.steps.length;
    const isLevelOne = this.currentLevel.level === 1;
    const areaWidth = isLevelOne ? 408 : totalCards <= 6 ? 850 : 936;
    const areaX = 480 - areaWidth / 2;

    const areaY = isLevelOne ? 312 : 300;
    const areaHeight = 132;

    shadow.fillRoundedRect(areaX + 6, areaY + 8, areaWidth, areaHeight, 24);

  shadow.setDepth(7);

    const bg = this.add.graphics();

    bg.fillStyle(0xffd54f, 0.68);
    bg.fillRoundedRect(areaX, areaY, areaWidth + 12, areaHeight, 24);

    bg.lineStyle(2, 0xffffff, 0.95);
    bg.strokeRoundedRect(areaX, areaY, areaWidth + 12, areaHeight, 24);

  bg.setDepth(8);
}

  private createCards() {
    const shuffled = Phaser.Utils.Array.Shuffle([...this.steps]);
    const isLevelOne = this.currentLevel.level === 1;
    const cardsPerRow = isLevelOne ? shuffled.length : shuffled.length;
    const spacing = isLevelOne ? 130 : shuffled.length <= 6 ? 136 : 116;
    const visualScale = 1;
    const rowY = [isLevelOne ? 378 : 366];
    const startX = 480 - ((cardsPerRow - 1) * spacing) / 2;

    shuffled.forEach((step, index) => {
      const row = Math.floor(index / cardsPerRow);
      const column = index % cardsPerRow;
      const x = startX + column * spacing;
      const y = rowY[row];
      this.createCard(x, y, step, visualScale);
      if (index === 0) this.firstCardPos = { x, y };
    });
  }

  private createCard(x: number, y: number, step: AlgorithmStep, visualScale = 1) {
    const container = this.add.container(x, y);
    container.setSize(CARD_WIDTH, CARD_HEIGHT);
    container.setScale(visualScale);
    container.setDepth(12);

    const shadow = this.add.graphics();
    shadow.fillStyle(0x000000, 0.13);
    shadow.fillRoundedRect(
      -CARD_WIDTH / 2 + 2,
      -CARD_HEIGHT / 2 + 10,
      CARD_WIDTH - 4,
      CARD_HEIGHT - 4,
      CARD_RADIUS
    );

    const bg = this.add.graphics();
    bg.fillStyle(COLORS.cream, 0.96);
    bg.fillRoundedRect(-CARD_WIDTH / 2, -CARD_HEIGHT / 2, CARD_WIDTH, CARD_HEIGHT, CARD_RADIUS);

    const image = this.add.image(0, -22, step.assetKey);
    image.texture.setFilter(Phaser.Textures.FilterMode.LINEAR);
    this.fitImage(image, CARD_IMAGE_WIDTH, CARD_IMAGE_HEIGHT);
    if (
      this.currentLevel.level === 1 &&
      (step.assetKey === 'cheese' || step.assetKey === 'sandwich')
    ) {
      image.setScale(image.scaleX * 0.88, image.scaleY * 0.88);
    }

    const text = this.add
      .text(0, 35, step.label, {
        fontFamily: 'DynaPuff, Arial, sans-serif',
        fontSize: '11px',
        fontStyle: 'bold',
        color: '#3b3b3b',
        align: 'center',
        wordWrap: { width: 84 },
      })
      .setOrigin(0.5)
      .setResolution(2);

    container.add([shadow, bg, image, text]);

    const hitbox = this.add.zone(x, y, CARD_HITBOX_WIDTH * visualScale, CARD_HITBOX_HEIGHT * visualScale);
    hitbox.setDepth(200);
    hitbox.setInteractive({ draggable: true, useHandCursor: true });
    hitbox.on('pointerdown', () => this.playButtonSound());

    hitbox.setData('card', container);
    hitbox.setData('step', step);
    container.setData('hitbox', hitbox);

    container.setData('step', step);
    container.setData('startX', x);
    container.setData('startY', y);
    container.setData('baseScale', visualScale);
    container.setData('currentSlotIndex', null);

    return container;
  }

  private createButton() {
    const buttonY = this.currentLevel.level === 1 ? 478 : 486;
    const button = this.add.container(480, buttonY);
    button.setDepth(40);

    const shadow = this.add.graphics();
    shadow.fillStyle(0x000000, 0.16);
    shadow.fillRoundedRect(-128, -20, 256, 46, 23);

    const bg = this.add.graphics();
    bg.fillStyle(COLORS.orange, 1);
    bg.fillRoundedRect(-132, -25, 264, 50, 25);
    bg.lineStyle(4, 0xffffff, 1);
    bg.strokeRoundedRect(-132, -25, 264, 50, 25);

    const text = this.add
      .text(0, 0, 'Testar algoritmo', {
        fontFamily: 'DynaPuff, Arial, sans-serif',
        fontSize: '21px',
        fontStyle: 'bold',
        color: '#ffffff',
        shadow: {
          offsetX: 0,
          offsetY: 2,
          color: '#9a3f00',
          blur: 0,
          fill: true,
        },
      })
      .setOrigin(0.5)
      .setResolution(2);

    button.add([shadow, bg, text]);

    const hitArea = new Phaser.Geom.Rectangle(-152, -36, 304, 72);

    button.setInteractive({
      hitArea,
      hitAreaCallback: Phaser.Geom.Rectangle.Contains,
      useHandCursor: true,
    });

    button.on('pointerdown', () => {
      this.playButtonSound();
      this.testAlgorithm();
    });
    button.on('pointerover', () => {
      this.tweens.add({ targets: button, scale: 1.04, duration: 90, ease: 'Sine.easeOut' });
    });
    button.on('pointerout', () => {
      this.tweens.add({ targets: button, scale: 1, duration: 90, ease: 'Sine.easeOut' });
    });

    this.testButton = button;
    this.testButtonBg = bg;
    this.testButtonText = text;
    this.updateTestButtonState();
  }

  private registerDragEvents() {
    this.input.on('dragstart', (_pointer: Phaser.Input.Pointer, gameObject: Phaser.GameObjects.GameObject) => {
      const hitbox = gameObject as Phaser.GameObjects.Zone;
      const card = hitbox.getData('card') as Phaser.GameObjects.Container;

      if (!card) return;

      this.startTimer();

      const currentSlot = card.getData('currentSlotIndex') as number | null;
      if (currentSlot !== null) {
        this.placedOrder[currentSlot] = null;
        card.setData('currentSlotIndex', null);
        this.updateTestButtonState();
      }

      hitbox.setDepth(300);
      card.setDepth(100);
      this.tweens.killTweensOf(card);
      this.tweens.killTweensOf(hitbox);
      card.setScale((card.getData('baseScale') as number) * 1.04);
    });

    this.input.on('drag', (
      _pointer: Phaser.Input.Pointer,
      gameObject: Phaser.GameObjects.GameObject,
      dragX: number,
      dragY: number
    ) => {
      const hitbox = gameObject as Phaser.GameObjects.Zone;
      const card = hitbox.getData('card') as Phaser.GameObjects.Container;

      if (!card) return;

      hitbox.x = dragX;
      hitbox.y = dragY;
      card.x = dragX;
      card.y = dragY;
    });

    this.input.on('dragend', (_pointer: Phaser.Input.Pointer, gameObject: Phaser.GameObjects.GameObject) => {
      const hitbox = gameObject as Phaser.GameObjects.Zone;
      const card = hitbox.getData('card') as Phaser.GameObjects.Container;

      if (!card) return;

      this.handleCardDrop(card);
    });
  }

  private handleCardDrop(card: Phaser.GameObjects.Container) {
    const step = card.getData('step') as AlgorithmStep;
    const hitbox = card.getData('hitbox') as Phaser.GameObjects.Zone;

    const slotIndex = this.sequenceSlots.findIndex((slot, index) => {
      const distance = Phaser.Math.Distance.Between(card.x, card.y, slot.x, slot.y);
      return distance < 86 && this.placedOrder[index] === null;
    });

    if (slotIndex === -1) {
      this.returnCard(card);
      return;
    }

    const slot = this.sequenceSlots[slotIndex];
    this.placedOrder[slotIndex] = step.correctOrder ?? -1;
    card.setData('currentSlotIndex', slotIndex);
    this.updateTestButtonState();
    this.playSlotSound();

    this.tweens.killTweensOf(card);
    this.tweens.killTweensOf(hitbox);

    this.tweens.add({
      targets: card,
      x: slot.x,
      y: slot.y,
      scale: card.getData('baseScale') as number,
      duration: 160,
      ease: 'Back.easeOut',
      onComplete: () => card.setDepth(20),
    });

    this.tweens.add({
      targets: hitbox,
      x: slot.x,
      y: slot.y,
      duration: 160,
      ease: 'Back.easeOut',
      onComplete: () => hitbox.setDepth(200),
    });
  }

  private returnCard(card: Phaser.GameObjects.Container) {
    const hitbox = card.getData('hitbox') as Phaser.GameObjects.Zone;

    card.setData('currentSlotIndex', null);
    this.updateTestButtonState();

    this.tweens.killTweensOf(card);
    this.tweens.killTweensOf(hitbox);

    this.tweens.add({
      targets: card,
      x: card.getData('startX'),
      y: card.getData('startY'),
      scale: card.getData('baseScale') as number,
      duration: 180,
      ease: 'Back.easeOut',
      onComplete: () => card.setDepth(12),
    });

    this.tweens.add({
      targets: hitbox,
      x: card.getData('startX'),
      y: card.getData('startY'),
      duration: 180,
      ease: 'Back.easeOut',
      onComplete: () => hitbox.setDepth(200),
    });
  }

  private testAlgorithm() {
    if (!this.isTestButtonEnabled || this.hasCompletedLevel) return;

    const correct = this.currentLevel.correctOrder.map((_, index) => index + 1);
    const isComplete = this.placedOrder.every((value) => value !== null);

    if (!isComplete) {
      this.showFeedback('Complete a sequência!', false);
      return;
    }

    const isCorrect = this.placedOrder.every((value, index) => value === correct[index]);

    if (isCorrect) {
      this.hasCompletedLevel = true;
      this.timerTween?.stop();
      this.hits += 1;
      this.currentPoints += 5;
      this.emitCorrectAnswer();
      this.emitCheckpoint();
      runtimeGameBridge.emit({
        type: 'GAME_COMPLETED',
        gameId: GAME_ID,
        stage: this.currentLevel.level,
      });

      if (this.currentLevel.level < 3) {
        this.showLevelCompleteScreen((this.currentLevel.level + 1) as 2 | 3);
        return;
      }

      this.showFinalLevelCompleteScreen();
      return;
    }

    this.errors += 1;
    this.currentPoints = Math.max(0, this.currentPoints - 5);
    this.perderVida();
    this.emitWrongAnswer();
    this.emitCheckpoint();
    this.showFeedback('Tente novamente!', false);
  }

  private updateTestButtonState() {
    const enabled = this.placedOrder.every((value) => value !== null);
    this.isTestButtonEnabled = enabled;

    if (!this.testButton || !this.testButtonBg || !this.testButtonText || !this.testButton.input) return;

    this.testButtonBg.clear();
    this.testButtonBg.fillStyle(enabled ? COLORS.orange : 0xb8c0cc, 1);
    this.testButtonBg.fillRoundedRect(-132, -25, 264, 50, 25);
    this.testButtonBg.lineStyle(4, 0xffffff, enabled ? 1 : 0.72);
    this.testButtonBg.strokeRoundedRect(-132, -25, 264, 50, 25);

    this.testButtonText.setAlpha(enabled ? 1 : 0.72);
    this.testButton.setAlpha(enabled ? 1 : 0.78);
    this.testButton.input.cursor = enabled ? 'pointer' : 'default';
  }

  private showLevelCompleteScreen(nextLevel: 2 | 3) {
    showLevelComplete(this, {
      subtitle: 'Nível concluído',
      message: this.currentLevel.successMessage,
      accent: COLORS.softOrange,
      progress: { total: 3, current: this.currentLevel.level },
      autoAdvance: {
        delay: 2300,
        onComplete: () => this.scene.restart({
          level: nextLevel,
          points: this.currentPoints,
          lives: this.currentLives,
          showLevelStart: true,
        }),
      },
    });
  }

  private showNextLevelStartScreen() {
    const overlay = this.add.rectangle(
      GAME_WIDTH / 2,
      GAME_HEIGHT / 2,
      GAME_WIDTH,
      GAME_HEIGHT,
      0x12324a,
      0.58
    );
    overlay.setDepth(450);
    overlay.setInteractive();

    const modal = this.add.container(GAME_WIDTH / 2, GAME_HEIGHT / 2);
    modal.setDepth(451);

    const shadow = this.add.graphics();
    shadow.fillStyle(0x000000, 0.18);
    shadow.fillRoundedRect(-270, -154, 540, 312, 28);

    const bg = this.add.graphics();
    bg.fillStyle(0xfff6e8, 0.98);
    bg.fillRoundedRect(-278, -166, 556, 312, 28);
    bg.lineStyle(5, 0xffffff, 0.95);
    bg.strokeRoundedRect(-278, -166, 556, 312, 28);

    const topBar = this.add.graphics();
    topBar.fillStyle(COLORS.green, 1);
    topBar.fillRoundedRect(-196, -182, 392, 28, 14);
    topBar.lineStyle(3, 0xffffff, 0.82);
    topBar.strokeRoundedRect(-196, -182, 392, 28, 14);

    const title = this.add
      .text(0, -102, `Nível ${this.currentLevel.level}`, {
        fontFamily: 'DynaPuff, Arial, sans-serif',
        fontSize: '38px',
        fontStyle: 'bold',
        color: '#25327a',
        stroke: '#ffffff',
        strokeThickness: 5,
      })
      .setOrigin(0.5)
      .setResolution(2);

    const objective = this.add
      .text(0, -42, this.currentLevel.title, {
        fontFamily: 'DynaPuff, Arial, sans-serif',
        fontSize: '24px',
        fontStyle: 'bold',
        color: '#f57c00',
        align: 'center',
        wordWrap: { width: 430 },
      })
      .setOrigin(0.5)
      .setResolution(2);

    const detail = this.add
      .text(0, 12, this.currentLevel.objective, {
        fontFamily: 'DynaPuff, Arial, sans-serif',
        fontSize: '16px',
        fontStyle: 'bold',
        color: '#3b3b3b',
        align: 'center',
        wordWrap: { width: 420 },
      })
      .setOrigin(0.5)
      .setResolution(2);

    const button = this.add.container(0, 104);
    const buttonShadow = this.add.graphics();
    buttonShadow.fillStyle(0x000000, 0.16);
    buttonShadow.fillRoundedRect(-136, -20, 272, 48, 24);
    const buttonBg = this.add.graphics();
    buttonBg.fillStyle(COLORS.orange, 1);
    buttonBg.fillRoundedRect(-140, -26, 280, 52, 26);
    buttonBg.lineStyle(4, 0xffffff, 1);
    buttonBg.strokeRoundedRect(-140, -26, 280, 52, 26);
    const buttonText = this.add
      .text(0, 0, 'Iniciar nível', {
        fontFamily: 'DynaPuff, Arial, sans-serif',
        fontSize: '22px',
        fontStyle: 'bold',
        color: '#ffffff',
        stroke: '#9a3f00',
        strokeThickness: 3,
      })
      .setOrigin(0.5)
      .setResolution(2);
    button.add([buttonShadow, buttonBg, buttonText]);

    const buttonHitbox = this.add.zone(GAME_WIDTH / 2, GAME_HEIGHT / 2 + 104, 280, 58);
    buttonHitbox.setDepth(452);
    buttonHitbox.setInteractive({ useHandCursor: true });
    buttonHitbox.on('pointerover', () => {
      this.tweens.add({ targets: button, scale: 1.04, duration: 90, ease: 'Sine.easeOut' });
    });
    buttonHitbox.on('pointerout', () => {
      this.tweens.add({ targets: button, scale: 1, duration: 90, ease: 'Sine.easeOut' });
    });
    buttonHitbox.on('pointerdown', () => {
      this.playButtonSound();
      overlay.destroy();
      buttonHitbox.destroy();
      modal.destroy();
      this.runTutorial();
    });

    modal.add([shadow, bg, topBar, title, objective, detail, button]);
    modal.setScale(0.9);
    modal.setAlpha(0);

    this.tweens.add({
      targets: modal,
      alpha: 1,
      scale: 1,
      duration: 260,
      ease: 'Back.easeOut',
    });
  }

  private showFinalLevelCompleteScreen() {
    const overlay = this.add.rectangle(
      GAME_WIDTH / 2,
      GAME_HEIGHT / 2,
      GAME_WIDTH,
      GAME_HEIGHT,
      0x12324a,
      0.56
    );
    overlay.setDepth(450);
    overlay.setInteractive();

    const modal = this.add.container(GAME_WIDTH / 2, GAME_HEIGHT / 2);
    modal.setDepth(451);

    const shadow = this.add.graphics();
    shadow.fillStyle(0x000000, 0.18);
    shadow.fillRoundedRect(-270, -166, 540, 330, 28);

    const bg = this.add.graphics();
    bg.fillStyle(0xfff6e8, 0.98);
    bg.fillRoundedRect(-278, -178, 556, 330, 28);
    bg.lineStyle(5, 0xffffff, 0.95);
    bg.strokeRoundedRect(-278, -178, 556, 330, 28);

    const topBar = this.add.graphics();
    topBar.fillStyle(COLORS.softOrange, 1);
    topBar.fillRoundedRect(-196, -194, 392, 28, 14);
    topBar.lineStyle(3, 0xffffff, 0.82);
    topBar.strokeRoundedRect(-196, -194, 392, 28, 14);

    const title = this.add
      .text(0, -110, 'Parabéns!', {
        fontFamily: 'DynaPuff, Arial, sans-serif',
        fontSize: '40px',
        fontStyle: 'bold',
        color: '#25327a',
        stroke: '#ffffff',
        strokeThickness: 5,
      })
      .setOrigin(0.5)
      .setResolution(2);

    const completed = this.add
      .text(0, -50, 'Nível concluído', {
        fontFamily: 'DynaPuff, Arial, sans-serif',
        fontSize: '26px',
        fontStyle: 'bold',
        color: '#f57c00',
      })
      .setOrigin(0.5)
      .setResolution(2);

    const message = this.add
      .text(0, 8, this.currentLevel.successMessage, {
        fontFamily: 'DynaPuff, Arial, sans-serif',
        fontSize: '17px',
        fontStyle: 'bold',
        color: '#3b3b3b',
        align: 'center',
        wordWrap: { width: 430 },
      })
      .setOrigin(0.5)
      .setResolution(2);

    const waitText = this.add
      .text(0, 116, 'Preparando a finalização...', {
        fontFamily: 'DynaPuff, Arial, sans-serif',
        fontSize: '15px',
        fontStyle: 'bold',
        color: '#25327a',
      })
      .setOrigin(0.5)
      .setResolution(2);

    modal.add([shadow, bg, topBar, title, completed, message, waitText]);
    modal.setScale(0.9);
    modal.setAlpha(0);

    this.tweens.add({
      targets: modal,
      alpha: 1,
      scale: 1,
      duration: 260,
      ease: 'Back.easeOut',
    });

    this.time.delayedCall(2300, () => {
      overlay.destroy();
      modal.destroy();
      this.showGameCompleteScreen();
    });
  }

  private showGameCompleteScreen() {
    const overlay = this.add.rectangle(
      GAME_WIDTH / 2,
      GAME_HEIGHT / 2,
      GAME_WIDTH,
      GAME_HEIGHT,
      0x12324a,
      0.62
    );
    overlay.setDepth(450);
    overlay.setInteractive();

    const panel = this.add.container(GAME_WIDTH / 2, GAME_HEIGHT / 2);
    panel.setDepth(451);

    const shadow = this.add.graphics();
    shadow.fillStyle(0x000000, 0.18);
    shadow.fillRoundedRect(-292, -178, 584, 366, 34);

    const bg = this.add.graphics();
    bg.fillStyle(0xfff6e8, 0.98);
    bg.fillRoundedRect(-304, -190, 608, 370, 34);
    bg.lineStyle(6, 0xffffff, 0.96);
    bg.strokeRoundedRect(-304, -190, 608, 370, 34);

    const ribbon = this.add.graphics();
    ribbon.fillStyle(COLORS.green, 1);
    ribbon.fillRoundedRect(-214, -208, 428, 34, 17);
    ribbon.lineStyle(4, 0xffffff, 0.9);
    ribbon.strokeRoundedRect(-214, -208, 428, 34, 17);

    const title = this.add
      .text(0, -128, 'Jogo concluído!', {
        fontFamily: 'DynaPuff, Arial, sans-serif',
        fontSize: '38px',
        fontStyle: 'bold',
        color: '#25327a',
        stroke: '#ffffff',
        strokeThickness: 6,
      })
      .setOrigin(0.5)
      .setResolution(2);

    const subtitle = this.add
      .text(0, -74, 'Você organizou todos os algoritmos.', {
        fontFamily: 'DynaPuff, Arial, sans-serif',
        fontSize: '20px',
        fontStyle: 'bold',
        color: '#3b3b3b',
        align: 'center',
        wordWrap: { width: 500 },
      })
      .setOrigin(0.5)
      .setResolution(2);

    const levelLabels = LEVELS.map((level, index) => {
      const item = this.add.container(-190 + index * 190, 54);

      const badge = this.add.graphics();
      badge.fillStyle(index === 0 ? COLORS.softOrange : index === 1 ? COLORS.blue : COLORS.green, 1);
      badge.fillRoundedRect(-54, -42, 108, 84, 18);
      badge.lineStyle(4, 0xffffff, 0.95);
      badge.strokeRoundedRect(-54, -42, 108, 84, 18);

      const number = this.add
        .text(0, -13, String(level.level), {
          fontFamily: 'DynaPuff, Arial, sans-serif',
          fontSize: '30px',
          fontStyle: 'bold',
          color: '#ffffff',
          stroke: '#25327a',
          strokeThickness: 4,
        })
        .setOrigin(0.5)
        .setResolution(2);

      const label = this.add
        .text(0, 23, 'concluído', {
          fontFamily: 'DynaPuff, Arial, sans-serif',
          fontSize: '12px',
          fontStyle: 'bold',
          color: '#ffffff',
        })
        .setOrigin(0.5)
        .setResolution(2);

      item.add([badge, number, label]);
      return item;
    });

    const createFinalButton = (
      x: number,
      label: string,
      color: number,
      stroke: string,
      onClick: () => void
    ) => {
      const button = this.add.container(x, 138);
      const buttonShadow = this.add.graphics();
      buttonShadow.fillStyle(0x000000, 0.16);
      buttonShadow.fillRoundedRect(-128, -20, 256, 48, 24);
      const buttonBg = this.add.graphics();
      buttonBg.fillStyle(color, 1);
      buttonBg.fillRoundedRect(-132, -26, 264, 52, 26);
      buttonBg.lineStyle(4, 0xffffff, 1);
      buttonBg.strokeRoundedRect(-132, -26, 264, 52, 26);
      const buttonText = this.add
        .text(0, 0, label, {
          fontFamily: 'DynaPuff, Arial, sans-serif',
          fontSize: '20px',
          fontStyle: 'bold',
          color: '#ffffff',
          stroke,
          strokeThickness: 3,
        })
        .setOrigin(0.5)
        .setResolution(2);
      button.add([buttonShadow, buttonBg, buttonText]);

      const buttonHitbox = this.add.zone(GAME_WIDTH / 2 + x, GAME_HEIGHT / 2 + 138, 264, 58);
      buttonHitbox.setDepth(452);
      buttonHitbox.setInteractive({ useHandCursor: true });
      buttonHitbox.on('pointerover', () => {
        this.tweens.add({ targets: button, scale: 1.04, duration: 90, ease: 'Sine.easeOut' });
      });
      buttonHitbox.on('pointerout', () => {
        this.tweens.add({ targets: button, scale: 1, duration: 90, ease: 'Sine.easeOut' });
      });
      buttonHitbox.on('pointerdown', () => {
        this.playButtonSound();
        onClick();
      });

      return { button, buttonHitbox };
    };

    const playAgain = createFinalButton(-142, 'Jogar novamente', COLORS.green, '#1b7d1c', () => {
      this.scene.restart({
        level: 1,
        points: this.currentPoints,
        lives: this.currentLives,
      });
    });

    const exit = createFinalButton(142, 'Voltar aos jogos', COLORS.orange, '#9a3f00', () => {
      EventBus.emit('exit-game');
    });

    const sparkles = Array.from({ length: 14 }, (_, index) => {
      const sparkle = this.add.graphics();
      const x = Phaser.Math.Between(-278, 278);
      const y = Phaser.Math.Between(-168, 158);
      sparkle.fillStyle(index % 3 === 0 ? COLORS.blue : index % 3 === 1 ? COLORS.softOrange : COLORS.green, 0.9);
      sparkle.fillCircle(x, y, Phaser.Math.Between(4, 8));
      this.tweens.add({
        targets: sparkle,
        alpha: { from: 0.35, to: 1 },
        scale: { from: 0.8, to: 1.35 },
        duration: 520 + index * 30,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
      return sparkle;
    });

    panel.add([
      shadow,
      bg,
      ribbon,
      ...sparkles,
      title,
      subtitle,
      ...levelLabels,
      playAgain.button,
      exit.button,
    ]);
    panel.setScale(0.88);
    panel.setAlpha(0);

    this.tweens.add({
      targets: panel,
      alpha: 1,
      scale: 1,
      duration: 300,
      ease: 'Back.easeOut',
    });
  }

  private coverImage(image: Phaser.GameObjects.Image, width: number, height: number) {
    const scale = Math.max(width / image.width, height / image.height);
    image.setScale(scale);
  }

  private fitImage(image: Phaser.GameObjects.Image, maxWidth: number, maxHeight: number) {
    const scale = Math.min(maxWidth / image.width, maxHeight / image.height);
    image.setScale(scale);
  }

  private playButtonSound() {
    this.playTone(520, 0.06, 0.18);
    this.time.delayedCall(55, () => this.playTone(760, 0.07, 0.16));
  }

  private playSlotSound() {
    this.playTone(660, 0.05, 0.035);
    this.time.delayedCall(45, () => this.playTone(920, 0.07, 0.035));
  }

  private getAudioContext(): AudioContext | null {
    if ('context' in this.sound) {
      return (this.sound as Phaser.Sound.WebAudioSoundManager).context;
    }

    const AudioContextCtor =
      window.AudioContext ||
      (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) return null;

    this.fallbackAudioContext ??= new AudioContextCtor();
    return this.fallbackAudioContext;
  }

  private playTone(frequency: number, duration: number, volume: number) {
    const ctx = this.getAudioContext();
    if (!ctx) return;

    if (ctx.state === 'suspended') {
      void ctx.resume().then(() => this.playTone(frequency, duration, volume));
      return;
    }

    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    const now = ctx.currentTime;

    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(frequency, now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(volume, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.02);
  }

  private emitReady() {
    runtimeGameBridge.emit({
      type: 'GAME_READY',
      gameId: GAME_ID,
    });
  }

  private emitCorrectAnswer() {
    runtimeGameBridge.emit({
      type: 'CORRECT_ANSWER',
      gameId: GAME_ID,
      pointsEarned: 5,
      stage: this.currentLevel.level,
    });
  }

  /**
   * A VIDA ACABOU — e este jogo nunca contava isso a ninguém.
   *
   * `currentLives` já era descontado em dois lugares (o tempo esgotado e a
   * ordem errada), sempre com `Math.max(0, ...)`, e nunca era LIDO. A criança
   * chegava a zero e o jogo seguia como se nada tivesse acontecido; de fora,
   * a partida parecia perfeita até o fim.
   *
   * ── POR QUE A TRANSIÇÃO, E NÃO O VALOR ───────────────────────────────
   *
   * `currentLives` nasce em 0 e só vira outra coisa se alguém mandar
   * `lives` na abertura da cena. Emitir "acabou" sempre que ele for zero
   * reprovaria a criança no primeiro erro de toda partida que não recebeu
   * vidas. Então o que conta é a BORDA: tinha vida, ficou sem.
   */
  private perderVida() {
    const antes = this.currentLives;
    this.currentLives = Math.max(0, antes - 1);

    if (antes > 0 && this.currentLives === 0) {
      runtimeGameBridge.emit({
        type: 'GAME_OVER',
        gameId: GAME_ID,
        stage: this.currentLevel.level,
      });
    }
  }

  private emitWrongAnswer() {
    runtimeGameBridge.emit({
      type: 'WRONG_ANSWER',
      gameId: GAME_ID,
      pointsEarned: -5,
      stage: this.currentLevel.level,
    });
  }

  private emitCheckpoint() {
    const placedCount = this.placedOrder.filter((value) => value !== null).length;
    const progress = Math.round((placedCount / this.currentLevel.correctOrder.length) * 100);

    runtimeGameBridge.emit({
      type: 'CHECKPOINT',
      gameId: GAME_ID,
      progress,
      score: this.currentPoints,
      stage: this.currentLevel.level,
      hits: this.hits,
      errors: this.errors,
    });
  }

  private registerPlatformCommands() {
    this.unsubscribePlatformCommands?.();
    this.unsubscribePlatformCommands = runtimeGameBridge.onCommand((command: PlatformCommand) => {
      switch (command.type) {
        case 'START_GAME':
          if (command.gameId !== GAME_ID) return;
          this.scene.restart({
            level: command.stage,
            points: command.points,
            lives: command.lives,
          });
          return;

        case 'PAUSE_GAME':
          this.scene.pause();
          return;

        case 'RESUME_GAME':
          this.scene.resume();
          return;

        case 'UNLOCK_GAME':
          return;
      }
    });

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.unsubscribePlatformCommands?.();
      this.unsubscribePlatformCommands = undefined;
      this.timerTween?.stop();
    });
  }

  private showFeedback(message: string, success: boolean) {
    const text = this.add
      .text(480, 310, message, {
        fontFamily: 'DynaPuff, Arial, sans-serif',
        fontSize: '23px',
        fontStyle: 'bold',
        color: success ? '#22c55e' : '#ef4444',
        backgroundColor: '#ffffff',
        padding: { left: 16, right: 16, top: 10, bottom: 10 },
      })
      .setOrigin(0.5)
      .setResolution(2)
      .setDepth(400);

    this.tweens.add({
      targets: text,
      alpha: 0,
      y: 290,
      delay: 1200,
      duration: 500,
      onComplete: () => text.destroy(),
    });
  }
}

