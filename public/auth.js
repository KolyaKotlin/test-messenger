const API_URL = 'http://localhost:3000';

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
const sendCodeBtn = document.getElementById('sendCodeBtn');
const verifyCodeBtn = document.getElementById('verifyCodeBtn');
const resendCodeBtn = document.getElementById('resendCodeBtn');
const registerUsername = document.getElementById('registerUsername');
const registerPassword = document.getElementById('registerPassword');
const registerPasswordConfirm = document.getElementById('registerPasswordConfirm');
const completeRegisterBtn = document.getElementById('completeRegisterBtn');
const emailDisplay = document.getElementById('emailDisplay');

let currentStep = 1;
let verificationCode = '';
let registrationEmail = '';

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
    resetRegisterForm();
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

// Send verification code
sendCodeBtn.addEventListener('click', async () => {
    const email = registerEmail.value.trim();

    if (!email || !validateEmail(email)) {
        showError('Введите корректный email');
        return;
    }

    sendCodeBtn.classList.add('loading');
    clearMessages();

    try {
        const response = await fetch(`${API_URL}/api/send-code`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ email })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Ошибка отправки кода');
        }

        registrationEmail = email;
        emailDisplay.textContent = email;
        showSuccess('Код отправлен на ваш email!');
        goToStep(2);

    } catch (error) {
        showError(error.message);
    } finally {
        sendCodeBtn.classList.remove('loading');
    }
});

// Code inputs handling
const codeInputs = document.querySelectorAll('.code-input');
codeInputs.forEach((input, index) => {
    input.addEventListener('input', (e) => {
        const value = e.target.value;

        if (value.length === 1 && index < codeInputs.length - 1) {
            codeInputs[index + 1].focus();
        }

        updateVerificationCode();
    });

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Backspace' && !e.target.value && index > 0) {
            codeInputs[index - 1].focus();
        }
    });

    input.addEventListener('paste', (e) => {
        e.preventDefault();
        const pastedData = e.clipboardData.getData('text').slice(0, 6);

        pastedData.split('').forEach((char, i) => {
            if (i < codeInputs.length) {
                codeInputs[i].value = char;
            }
        });

        updateVerificationCode();

        if (pastedData.length === 6) {
            codeInputs[5].focus();
        }
    });
});

function updateVerificationCode() {
    verificationCode = Array.from(codeInputs).map(input => input.value).join('');
}

// Verify code
verifyCodeBtn.addEventListener('click', async () => {
    if (verificationCode.length !== 6) {
        showError('Введите 6-значный код');
        return;
    }

    verifyCodeBtn.classList.add('loading');
    clearMessages();

    try {
        const response = await fetch(`${API_URL}/api/verify-code`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                email: registrationEmail,
                code: verificationCode
            })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Неверный код');
        }

        showSuccess('Код подтвержден!');
        goToStep(3);

    } catch (error) {
        showError(error.message);
        codeInputs.forEach(input => input.value = '');
        codeInputs[0].focus();
        verificationCode = '';
    } finally {
        verifyCodeBtn.classList.remove('loading');
    }
});

// Resend code
resendCodeBtn.addEventListener('click', async () => {
    resendCodeBtn.classList.add('loading');
    clearMessages();

    try {
        const response = await fetch(`${API_URL}/api/send-code`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ email: registrationEmail })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Ошибка отправки кода');
        }

        showSuccess('Код отправлен повторно!');
        codeInputs.forEach(input => input.value = '');
        codeInputs[0].focus();
        verificationCode = '';

    } catch (error) {
        showError(error.message);
    } finally {
        resendCodeBtn.classList.remove('loading');
    }
});

// Complete registration
completeRegisterBtn.addEventListener('click', async () => {
    const username = registerUsername.value.trim();
    const password = registerPassword.value;
    const passwordConfirm = registerPasswordConfirm.value;

    if (!username || !password || !passwordConfirm) {
        showError('Заполните все поля');
        return;
    }

    if (username.length < 3) {
        showError('Имя пользователя должно быть не менее 3 символов');
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

    completeRegisterBtn.classList.add('loading');
    clearMessages();

    try {
        const response = await fetch(`${API_URL}/api/register`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                username,
                email: registrationEmail,
                password,
                code: verificationCode
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
        completeRegisterBtn.classList.remove('loading');
    }
});

// Helper functions
function goToStep(step) {
    document.querySelectorAll('.register-step').forEach(s => {
        s.classList.remove('active');
    });
    document.querySelector(`.register-step[data-step="${step}"]`).classList.add('active');
    currentStep = step;
}

function resetRegisterForm() {
    goToStep(1);
    registerEmail.value = '';
    registerUsername.value = '';
    registerPassword.value = '';
    registerPasswordConfirm.value = '';
    codeInputs.forEach(input => input.value = '');
    verificationCode = '';
    registrationEmail = '';
}

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
    if (e.key === 'Enter') sendCodeBtn.click();
});

registerUsername.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') registerPassword.focus();
});

registerPassword.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') registerPasswordConfirm.focus();
});

registerPasswordConfirm.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') completeRegisterBtn.click();
});

// Check if already logged in
if (localStorage.getItem('token')) {
    window.location.href = 'app.html';
}
