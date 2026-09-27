// Registry of widget apps the shell can open in a window. Keys are the window record's content type.

import explore from './explore.js';
import calculator from './calculator.js';
import browser from './browser-mirror.js';
import todo from './todo.js';
import notepad from './notepad.js';
import calendar from './calendar.js';
import timer from './timer.js';
import pong from './pong.js';
import chess from './chess.js';
import music from './music.js';
import weather from './weather.js';
import youtube from './youtube.js';

export const APPS = { calculator, browser, todo, notepad, calendar, timer, pong, chess, music, weather, youtube, explore };
