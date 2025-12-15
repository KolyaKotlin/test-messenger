const API_URL = 'http://31.57.109.22';

// Elements
const loginForm = document.getElementById('loginForm');
const registerForm = document.getElementById('registerForm');
const showRegisterLink = document.getElementById('showRegister');
const showLoginLink = document.getElementById('showLogin');
const errorMessage = document.getElementById('errorMessage');
const successMessage = document.getElementById('successMessage');

// Login elements
const loginEmail = document.getElementById('loginEmail');
const loginPassword = document.getElementById('loginPassword');
const loginBtn = document.getElementById('loginBtn');

// Register elements
const registerEmail = document.getElementById('registerEmail');
const registerUsername = document.getElementById('registerUsername');
const registerKey = document.getElementById('registerKey');
const registerPassword = document.getElementById('registerPassword');
const registerPasswordConfirm = document.getElementById('registerPasswordConfirm');
const registerBtn = document.getElementById('registerBtn');
const keyCounter = document.querySelector('.key-counter');

// Switch forms
showRegisterLink.addEventListener('click', (e) => {
    e.preventDefault();
    loginForm.classList.remove('active');
    registerForm.classList.add('active');
    clearMessages();
});

showLoginLink.addEventListener('click', (e) => {
    e.preventDefault();
    registerForm.classList.remove('active');
    loginForm.classList.add('active');
    clearMessages();
});

// Toggle password visibility
document.querySelectorAll('.toggle-password').forEach(icon => {
    icon.addEventListener('click', function() {
        const input = this.previousElementSibling;
        if (input.type === 'password') {
            input.type = 'text';
            this.classList.remove('fa-eye');
            this.classList.add('fa-eye-slash');
        } else {
            input.type = 'password';
            this.classList.remove('fa-eye-slash');
            this.classList.add('fa-eye');
        }
    });
});

// Key counter
registerKey.addEventListener('input', () => {
    const length = registerKey.value.length;
    keyCounter.textContent = `${length}/16`;

    if (length === 16) {
        keyCounter.classList.add('complete');
    } else {
        keyCounter.classList.remove('complete');
    }
});

// Multi-step registration
let currentStep = 1;

function goToStep(step) {
    // Hide all steps
    document.querySelectorAll('.register-step').forEach(s => s.classList.remove('active'));
    document.querySelectorAll('.progress-steps .step').forEach(s => s.classList.remove('active', 'completed'));

    // Show current step
    document.querySelector(`.register-step[data-step="${step}"]`).classList.add('active');
    document.querySelector(`.progress-steps .step[data-step="${step}"]`).classList.add('active');

    // Mark completed steps
    for (let i = 1; i < step; i++) {
        document.querySelector(`.progress-steps .step[data-step="${i}"]`).classList.add('completed');
    }

    currentStep = step;
    clearMessages();
}

// Step 1 -> Step 2
document.getElementById('nextStep1').addEventListener('click', () => {
    const email = registerEmail.value.trim();
    const username = registerUsername.value.trim();

    if (!email || !username) {
        showError('Заполните все поля');
        return;
    }

    if (!email.includes('@')) {
        showError('Введите корректный email');
        return;
    }

    goToStep(2);
});

// Step 2 -> Step 1
document.getElementById('prevStep2').addEventListener('click', () => {
    goToStep(1);
});

// Step 2 -> Step 3
document.getElementById('nextStep2').addEventListener('click', () => {
    const key = registerKey.value.trim();

    if (!key || key.length !== 16) {
        showError('Введите 16-значный ключ');
        return;
    }

    goToStep(3);
});

// Step 3 -> Step 2
document.getElementById('prevStep3').addEventListener('click', () => {
    goToStep(2);
});

// Login
loginBtn.addEventListener('click', async () => {
    const email = loginEmail.value.trim();
    const password = loginPassword.value;

    if (!email || !password) {
        showError('Заполните все поля');
        return;
    }

    loginBtn.classList.add('loading');
    clearMessages();

    try {
        const response = await fetch(`${API_URL}/api/login`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ email, password })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Ошибка входа');
        }

        localStorage.setItem('token', data.token);
        localStorage.setItem('user', JSON.stringify(data.user));

        showSuccess('Вход выполнен успешно!');

        setTimeout(() => {
            window.location.href = 'app.html';
        }, 500);

    } catch (error) {
        showError(error.message);
    } finally {
        loginBtn.classList.remove('loading');
    }
});

// Register
registerBtn.addEventListener('click', async () => {
    const email = registerEmail.value.trim();
    const username = registerUsername.value.trim();
    const key = registerKey.value.trim();
    const password = registerPassword.value;
    const passwordConfirm = registerPasswordConfirm.value;

    if (!email || !username || !key || !password || !passwordConfirm) {
        showError('Заполните все поля');
        return;
    }

    if (!validateEmail(email)) {
        showError('Введите корректный email');
        return;
    }

    if (username.length < 3) {
        showError('Имя пользователя должно быть не менее 3 символов');
        return;
    }

    if (key.length !== 16) {
        showError('Ключ должен содержать 16 символов');
        return;
    }

    if (password.length < 6) {
        showError('Пароль должен быть не менее 6 символов');
        return;
    }

    if (password !== passwordConfirm) {
        showError('Пароли не совпадают');
        return;
    }

    registerBtn.classList.add('loading');
    clearMessages();

    try {
        const response = await fetch(`${API_URL}/api/register`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                username,
                email,
                password,
                key
            })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Ошибка регистрации');
        }

        localStorage.setItem('token', data.token);
        localStorage.setItem('user', JSON.stringify(data.user));

        showSuccess('Регистрация успешна!');

        setTimeout(() => {
            window.location.href = 'app.html';
        }, 500);

    } catch (error) {
        showError(error.message);
    } finally {
        registerBtn.classList.remove('loading');
    }
});

// Helper functions
function validateEmail(email) {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email);
}

function showError(message) {
    errorMessage.textContent = message;
    errorMessage.classList.add('show');
    setTimeout(() => {
        errorMessage.classList.remove('show');
    }, 5000);
}

function showSuccess(message) {
    successMessage.textContent = message;
    successMessage.classList.add('show');
    setTimeout(() => {
        successMessage.classList.remove('show');
    }, 3000);
}

function clearMessages() {
    errorMessage.classList.remove('show');
    successMessage.classList.remove('show');
}

// Enter key handling
loginEmail.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') loginPassword.focus();
});

loginPassword.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') loginBtn.click();
});

registerEmail.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') registerUsername.focus();
});

registerUsername.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') registerKey.focus();
});

registerKey.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') registerPassword.focus();
});

registerPassword.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') registerPasswordConfirm.focus();
});

registerPasswordConfirm.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') registerBtn.click();
});

// Check if already logged in
if (localStorage.getItem('token')) {
    window.location.href = 'app.html';
}
