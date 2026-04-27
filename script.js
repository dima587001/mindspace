/**
 * MindSpace - Модуль чата с ИИ
 * Улучшенная версия с безопасностью, доступностью и производительностью
 */

(function() {
    'use strict';

    // ============================================
    // КОНФИГУРАЦИЯ И УТИЛИТЫ
    // ============================================
    
    const CONFIG = {
        selectors: {
            topicSelect: '#topicSelect',
            chatSection: '#chatSection',
            howItWorksSection: '#howItWorksSection',
            messages: '#messages',
            messageInput: '#messageInput',
            voiceButton: '#voiceButton',
            voiceStatus: '#voiceStatus',
            aiModeratorBtn: '#aiModeratorBtn',
            findPartnerBtn: '#findPartnerBtn',
            sendBtn: '#sendBtn',
            howItWorksBtn: '#howItWorksBtn',
            returnToChatBtn: '#returnToChatBtn'
        },
        storageKeys: {
            lastTopic: 'mindspace_last_topic',
            chatHistory: 'mindspace_chat_history'
        }
    };

    // Полная таблица соответствия латинской и кириллической раскладки
    const layoutMap = {
        // Строчные буквы
        q: 'й', w: 'ц', e: 'у', r: 'к', t: 'е', y: 'н', u: 'г', i: 'ш', o: 'щ', p: 'з',
        a: 'ф', s: 'ы', d: 'в', f: 'а', g: 'п', h: 'р', j: 'о', k: 'л', l: 'д',
        z: 'я', x: 'ч', c: 'с', v: 'м', b: 'и', n: 'т', m: 'ь',
        '[': 'х', ']': 'ъ', ';': 'ж', "'": 'э', ',': 'б', '.': 'ю',
        // Заглавные буквы
        Q: 'Й', W: 'Ц', E: 'У', R: 'К', T: 'Е', Y: 'Н', U: 'Г', I: 'Ш', O: 'Щ', P: 'З',
        A: 'Ф', S: 'Ы', D: 'В', F: 'А', G: 'П', H: 'Р', J: 'О', K: 'Л', L: 'Д',
        Z: 'Я', X: 'Ч', C: 'С', V: 'М', B: 'И', N: 'Т', M: 'Ь',
        '{': 'Х', '}': 'Ъ', ':': 'Ж', '"': 'Э', '<': 'Б', '>': 'Ю',
        // Спецсимволы
        '`': 'ё', '~': 'Ё', '@': '"', '#': '№', '$': ';', '^': ':'
    };

    // Обратная таблица для перевода с кириллицы на латиницу
    const reverseLayoutMap = Object.fromEntries(
        Object.entries(layoutMap).map(([latin, cyrillic]) => [cyrillic, latin])
    );

    /**
     * Безопасное экранирование HTML для предотвращения XSS
     * @param {string} text - Текст для экранирования
     * @returns {string} - Безопасный HTML
     */
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * Перевод текста между раскладками (двунаправленный)
     * @param {string} input - Входной текст
     * @param {boolean} isLatinToCyrillic - Направление перевода
     * @returns {string} - Переведенный текст
     */
    function translateText(input, isLatinToCyrillic = true) {
        const map = isLatinToCyrillic ? layoutMap : reverseLayoutMap;
        return input.split('').map(char => map[char] || char).join('');
    }

    /**
     * Создание элемента с использованием DocumentFragment для производительности
     * @param {string} tag - Тег элемента
     * @param {object} props - Свойства элемента
     * @param {string} content - Текстовое содержимое
     * @returns {HTMLElement} - Созданный элемент
     */
    function createElement(tag, props = {}, content = '') {
        const element = document.createElement(tag);
        Object.entries(props).forEach(([key, value]) => {
            if (key === 'className') {
                element.className = value;
            } else if (key === 'dataset') {
                Object.entries(value).forEach(([dataKey, dataValue]) => {
                    element.dataset[dataKey] = dataValue;
                });
            } else if (key.startsWith('on') && typeof value === 'function') {
                element.addEventListener(key.slice(2).toLowerCase(), value);
            } else if (value !== null && value !== undefined) {
                element.setAttribute(key, value);
            }
        });
        if (content) {
            element.textContent = content;
        }
        return element;
    }

    /**
     * Показ уведомления пользователю
     * @param {string} message - Текст уведомления
     * @param {string} type - Тип уведомления (success, error, warning)
     */
    function showToast(message, type = 'success') {
        const toast = createElement('div', { 
            className: `toast ${type}`,
            role: 'alert'
        }, message);
        
        document.body.appendChild(toast);
        
        setTimeout(() => {
            toast.style.animation = 'slideIn 0.3s ease-out reverse';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

    // ============================================
    // МОДУЛЬ ЧАТА
    // ============================================
    
    const ChatModule = {
        elements: {},
        recognition: null,
        isListening: false,

        /**
         * Инициализация модуля
         */
        init() {
            this.cacheElements();
            this.bindEvents();
            this.initVoiceRecognition();
            this.loadSavedState();
            this.updateUI();
        },

        /**
         * Кэширование DOM элементов
         */
        cacheElements() {
            Object.entries(CONFIG.selectors).forEach(([key, selector]) => {
                this.elements[key] = document.querySelector(selector);
            });
        },

        /**
         * Привязка обработчиков событий
         */
        bindEvents() {
            // Кнопки навигации
            this.elements.findPartnerBtn?.addEventListener('click', () => this.findPartner());
            this.elements.howItWorksBtn?.addEventListener('click', () => this.showHowItWorks());
            this.elements.returnToChatBtn?.addEventListener('click', () => this.returnToChat());
            this.elements.aiModeratorBtn?.addEventListener('click', () => this.addAIComment());
            
            // Отправка сообщений
            this.elements.sendBtn?.addEventListener('click', () => this.sendMessage());
            this.elements.messageInput?.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    this.sendMessage();
                }
            });

            // Голосовой ввод
            this.elements.voiceButton?.addEventListener('click', () => this.toggleVoiceInput());
        },

        /**
         * Инициализация голосового распознавания
         */
        initVoiceRecognition() {
            const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
            
            if (!SpeechRecognition) {
                this.elements.voiceButton.disabled = true;
                this.elements.voiceButton.title = 'Голосовой ввод не поддерживается вашим браузером';
                return;
            }

            try {
                this.recognition = new SpeechRecognition();
                this.recognition.continuous = false;
                this.recognition.interimResults = false;
                this.recognition.lang = 'ru-RU';

                this.recognition.onstart = () => {
                    this.isListening = true;
                    this.elements.voiceButton.classList.add('active');
                    this.elements.voiceButton.setAttribute('aria-pressed', 'true');
                    this.showVoiceStatus('Слушаю... Говорите сейчас.');
                };

                this.recognition.onresult = (event) => {
                    const transcript = event.results[0][0].transcript;
                    this.elements.messageInput.value = transcript;
                    this.elements.messageInput.focus();
                    showToast('Текст распознан', 'success');
                };

                this.recognition.onerror = (event) => {
                    console.error('Ошибка голосового распознавания:', event.error);
                    let errorMessage = 'Произошла ошибка при распознавании речи.';
                    
                    switch(event.error) {
                        case 'no-speech':
                            errorMessage = 'Речь не обнаружена. Попробуйте еще раз.';
                            break;
                        case 'audio-capture':
                            errorMessage = 'Не удалось получить доступ к микрофону.';
                            break;
                        case 'not-allowed':
                            errorMessage = 'Доступ к микрофону запрещен. Разрешите доступ в настройках браузера.';
                            break;
                    }
                    
                    showToast(errorMessage, 'error');
                    this.stopVoiceInput();
                };

                this.recognition.onend = () => {
                    this.stopVoiceInput();
                };

            } catch (error) {
                console.error('Ошибка инициализации голосового ввода:', error);
                this.elements.voiceButton.disabled = true;
            }
        },

        /**
         * Переключение голосового ввода
         */
        toggleVoiceInput() {
            if (!this.recognition) {
                showToast('Голосовой ввод не поддерживается', 'error');
                return;
            }

            if (this.isListening) {
                this.recognition.stop();
            } else {
                try {
                    this.recognition.start();
                } catch (error) {
                    console.error('Ошибка запуска голосового ввода:', error);
                    showToast('Не удалось запустить голосовой ввод', 'error');
                }
            }
        },

        /**
         * Остановка голосового ввода
         */
        stopVoiceInput() {
            this.isListening = false;
            this.elements.voiceButton.classList.remove('active');
            this.elements.voiceButton.setAttribute('aria-pressed', 'false');
            this.hideVoiceStatus();
        },

        /**
         * Показ статуса голосового ввода
         * @param {string} message - Сообщение статуса
         */
        showVoiceStatus(message) {
            this.elements.voiceStatus.textContent = message;
            this.elements.voiceStatus.hidden = false;
        },

        /**
         * Скрытие статуса голосового ввода
         */
        hideVoiceStatus() {
            this.elements.voiceStatus.hidden = true;
            this.elements.voiceStatus.textContent = '';
        },

        /**
         * Поиск собеседника
         */
        findPartner() {
            const topic = this.elements.topicSelect?.value;
            
            if (!topic) {
                showToast('Пожалуйста, выберите тему', 'warning');
                this.elements.topicSelect?.focus();
                return;
            }

            // Сохранение выбранной темы
            localStorage.setItem(CONFIG.storageKeys.lastTopic, topic);

            // Показ чата
            this.elements.chatSection.hidden = false;
            this.elements.aiModeratorBtn.hidden = false;
            
            // Фокус на поле ввода
            setTimeout(() => {
                this.elements.messageInput?.focus();
            }, 100);

            showToast(`Собеседник найден! Тема: ${topic}`, 'success');
            
            // Добавление системного сообщения
            this.addSystemMessage(`Чат начат. Тема: ${topic}`);
        },

        /**
         * Отправка сообщения
         */
        sendMessage() {
            const message = this.elements.messageInput?.value.trim();
            
            if (!message) {
                showToast('Введите сообщение', 'warning');
                this.elements.messageInput?.focus();
                return;
            }

            // Безопасное добавление сообщения пользователя
            this.addMessage('Вы', message, 'user');

            // Проверка раскладки и перевод
            const hasLatin = /[a-zA-Z`~@#$%^&*(){}\[\];'",.<>]/.test(message);
            const hasCyrillic = /[а-яёА-ЯЁ]/.test(message);

            if (hasLatin && !hasCyrillic) {
                const translated = translateText(message, true);
                this.addMessage('Перевод', translated, 'translation');
            } else if (hasCyrillic) {
                const translated = translateText(message, false);
                if (translated !== message) {
                    this.addMessage('Translation', translated, 'translation');
                }
            }

            // Очистка поля ввода
            this.elements.messageInput.value = '';

            // Эмуляция ответа собеседника
            this.simulateResponse();

            // Сохранение истории
            this.saveChatHistory();
        },

        /**
         * Добавление сообщения в чат
         * @param {string} sender - Отправитель
         * @param {string} text - Текст сообщения
         * @param {string} type - Тип сообщения
         */
        addMessage(sender, text, type = 'user') {
            const messageContainer = document.createDocumentFragment();
            
            const messageEl = createElement('p', {
                'data-message-type': type
            });
            
            const senderEl = createElement('strong', {}, `${sender}: `);
            const textEl = document.createTextNode(escapeHtml(text));
            
            messageEl.appendChild(senderEl);
            messageEl.appendChild(textEl);
            messageContainer.appendChild(messageEl);
            
            this.elements.messages.appendChild(messageContainer);
            this.scrollToBottom();
        },

        /**
         * Добавление системного сообщения
         * @param {string} text - Текст сообщения
         */
        addSystemMessage(text) {
            const messageEl = createElement('p', {
                'data-message-type': 'system',
                style: 'font-style: italic; color: #666;'
            }, text);
            
            this.elements.messages.appendChild(messageEl);
            this.scrollToBottom();
        },

        /**
         * Эмуляция ответа собеседника
         */
        simulateResponse() {
            setTimeout(() => {
                const responses = [
                    'Это интересная тема! Давайте обсудим её подробнее.',
                    'Расскажите больше о вашем мнении.',
                    'Я согласен с вами. Что вы думаете об этом?',
                    'Интересная точка зрения. Есть ли какие-то примеры?',
                    'Давайте углубимся в эту тему.'
                ];
                
                const randomResponse = responses[Math.floor(Math.random() * responses.length)];
                this.addMessage('Собеседник', randomResponse, 'partner');
                this.saveChatHistory();
            }, 1000 + Math.random() * 1000);
        },

        /**
         * Вызов модератора-ИИ
         */
        addAIComment() {
            const comments = [
                'Как я могу помочь вам сегодня?',
                'Напомню о правилах общения: уважайте собеседника.',
                'Если у вас возникли вопросы, я готов помочь.',
                'Обсуждение должно быть конструктивным и полезным.'
            ];
            
            const randomComment = comments[Math.floor(Math.random() * comments.length)];
            this.addMessage('Модератор-ИИ', randomComment, 'moderator');
            showToast('Модератор-ИИ добавил комментарий', 'success');
        },

        /**
         * Показ раздела "Как это работает"
         */
        showHowItWorks() {
            this.elements.chatSection.hidden = true;
            this.elements.aiModeratorBtn.hidden = true;
            this.elements.howItWorksSection.hidden = false;
        },

        /**
         * Возврат в чат
         */
        returnToChat() {
            this.elements.howItWorksSection.hidden = true;
            
            const hasTopic = this.elements.topicSelect?.value;
            if (hasTopic) {
                this.elements.chatSection.hidden = false;
                this.elements.aiModeratorBtn.hidden = false;
            }
        },

        /**
         * Прокрутка к последнему сообщению
         */
        scrollToBottom() {
            if (this.elements.messages) {
                this.elements.messages.scrollTop = this.elements.messages.scrollHeight;
            }
        },

        /**
         * Сохранение истории чата
         */
        saveChatHistory() {
            try {
                const messages = Array.from(this.elements.messages.querySelectorAll('p'))
                    .map(p => ({
                        type: p.dataset.messageType || 'user',
                        text: p.textContent
                    }));
                
                localStorage.setItem(
                    CONFIG.storageKeys.chatHistory,
                    JSON.stringify(messages)
                );
            } catch (error) {
                console.warn('Не удалось сохранить историю чата:', error);
            }
        },

        /**
         * Загрузка сохраненного состояния
         */
        loadSavedState() {
            try {
                // Загрузка последней темы
                const lastTopic = localStorage.getItem(CONFIG.storageKeys.lastTopic);
                if (lastTopic && this.elements.topicSelect) {
                    this.elements.topicSelect.value = lastTopic;
                }

                // Загрузка истории чата
                const history = localStorage.getItem(CONFIG.storageKeys.chatHistory);
                if (history && this.elements.messages) {
                    const messages = JSON.parse(history);
                    messages.forEach(msg => {
                        this.addMessage(
                            msg.type === 'user' ? 'Вы' : 
                            msg.type === 'partner' ? 'Собеседник' :
                            msg.type === 'moderator' ? 'Модератор-ИИ' :
                            msg.type === 'translation' ? 'Перевод' : 'Система',
                            msg.text.replace(/^[^:]+: /, ''),
                            msg.type
                        );
                    });
                }
            } catch (error) {
                console.warn('Не удалось загрузить сохраненное состояние:', error);
            }
        },

        /**
         * Обновление UI
         */
        updateUI() {
            // Проверка поддержки функций
            if (!window.localStorage) {
                showToast('Ваш браузер не поддерживает локальное хранилище', 'warning');
            }
        }
    };

    // ============================================
    // ЗАПУСК ПРИЛОЖЕНИЯ
    // ============================================
    
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => ChatModule.init());
    } else {
        ChatModule.init();
    }

    // Экспорт для отладки (опционально)
    window.MindSpace = { ChatModule };

})();