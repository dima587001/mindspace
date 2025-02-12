// Таблица соответствия латинской и кириллической раскладки
const layoutMap = {
    q: 'й', w: 'ц', e: 'у', r: 'к', t: 'е', y: 'н', u: 'г', i: 'ш', o: 'щ', p: 'з',
    a: 'ф', s: 'ы', d: 'в', f: 'а', g: 'п', h: 'р', j: 'о', k: 'л', l: 'д',
    z: 'я', x: 'ч', c: 'с', v: 'м', b: 'и', n: 'т', m: 'ь',
    '[': 'х', ']': 'ъ', ';': 'ж', "'": 'э', ',': 'б', '.': 'ю'
};

// Создаем обратную таблицу для перевода с кириллицы на латиницу
const reverseLayoutMap = {};
for (const [latin, cyrillic] of Object.entries(layoutMap)) {
    reverseLayoutMap[cyrillic] = latin;
}

// Функция перевода текста (двунаправленная)
function translateText(input, isLatinToCyrillic = true) {
    const map = isLatinToCyrillic ? layoutMap : reverseLayoutMap;
    return input.split('').map(char => map[char.toLowerCase()] || char).join('');
}

// Поиск собеседника по теме
function findPartner() {
    const topic = document.getElementById("topicSelect").value;
    if (!topic) {
        alert("Пожалуйста, выберите тему.");
        return;
    }
    alert(`Собеседник найден! Тема: ${topic}`);
    document.getElementById("chatSection").style.display = "flex";
}

// Отправка сообщений
function sendMessage() {
    const messageInput = document.getElementById("message");
    const messagesDiv = document.getElementById("messages");
    const message = messageInput.value.trim();
    if (!message) {
        alert("Пожалуйста, введите сообщение.");
        return;
    }
    // Определение языка
    const isLatin = /[a-zA-Z]/.test(message);
    const isCyrillic = /[а-яё]/i.test(message);
    // Отправка сообщения
    messagesDiv.innerHTML += `<p><strong>Вы:</strong> ${message}</p>`;
    // Если текст написан латиницей, переводим в кириллицу
    if (isLatin) {
        const translatedMessage = translateText(message, true); // Латиница → Кириллица
        messagesDiv.innerHTML += `<p><strong>Перевод:</strong> ${translatedMessage}</p>`;
    }
    // Если текст написан кириллицей, переводим в латиницу
    if (isCyrillic) {
        const translatedMessage = translateText(message, false); // Кириллица → Латиница
        messagesDiv.innerHTML += `<p><strong>Перевод:</strong> ${translatedMessage}</p>`;
    }
    // Эмуляция ответа от ИИ
    setTimeout(() => {
        messagesDiv.innerHTML += `<p><strong>Собеседник:</strong> Это интересная тема! Давайте обсудим её подробнее.</p>`;
    }, 1000);
    // Очистка поля ввода
    messageInput.value = '';
}

// Переключение между чатом и разделом "Как это работает"
function showHowItWorks() {
    document.getElementById("chatSection").style.display = "none";
    document.getElementById("howItWorksSection").style.display = "block";
}

function returnToChat() {
    document.getElementById("chatSection").style.display = "flex";
    document.getElementById("howItWorksSection").style.display = "none";
}

// Вызов модератора-ИИ
function addAIComment(event) {
    event.preventDefault();
    const messagesDiv = document.getElementById("messages");
    messagesDiv.innerHTML += `<p><strong>Модератор-ИИ:</strong> Как я могу помочь вам сегодня?</p>`;
}

// Голосовой ввод
let recognition;

function toggleVoiceInput() {
    if (!recognition) {
        recognition = new webkitSpeechRecognition();
        recognition.continuous = false;
        recognition.interimResults = false;
        recognition.lang = 'ru-RU';

        recognition.onresult = function(event) {
            const transcript = event.results[0][0].transcript;
            document.getElementById("message").value = transcript;
        };

        recognition.onerror = function(event) {
            console.error('Ошибка голосового распознавания: ', event.error);
        };
    }

    recognition.start();
    document.getElementById("voiceButton").classList.add("active");
    recognition.onend = function() {
        document.getElementById("voiceButton").classList.remove("active");
    };
}