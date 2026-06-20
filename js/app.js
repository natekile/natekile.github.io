import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getFirestore, collection, addDoc, getDocs, updateDoc, doc, getDoc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { firebaseConfig, DISCORD_WEBHOOK_URL } from "./config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const ROLES_LANG = {
    governor: "Губернатор",
    vice_governor: "Вице-губернатор",
    attorney_general: "Генеральный прокурор",
    deputy_attorney_general: "Заместитель Генерального прокурора",
    prosecutor: "Прокурор",
    assistant_prosecutor: "Помощник прокурора"
};

const ROLE_PRIORITY = {
    governor: 1,
    vice_governor: 2,
    attorney_general: 3,
    deputy_attorney_general: 4,
    prosecutor: 5,
    assistant_prosecutor: 6
};

const APPROVER_ROLES = ['governor', 'vice_governor', 'attorney_general', 'deputy_attorney_general'];
const REVIEWER_ROLES = ['governor', 'vice_governor', 'attorney_general', 'deputy_attorney_general', 'prosecutor'];

let currentUserData = null;

// Суффикс для симуляции Email в Firebase Auth на основе Discord ID
const DISCORD_EMAIL_SUFFIX = "@portal.local";

onAuthStateChanged(auth, async (user) => {
    if (user) {
        try {
            const docRef = doc(db, "users", user.uid);
            const docSnap = await getDoc(docRef);
            
            if (docSnap.exists()) {
                currentUserData = docSnap.data();
                
                if (!currentUserData.isVerified) {
                    showSection('pending-approval');
                    setupPendingLogout();
                    hideEmployeeUI();
                    return;
                }

                document.getElementById('nav-login').classList.add('hidden');
                document.getElementById('nav-logout').classList.remove('hidden');
                document.getElementById('nav-dashboard').classList.remove('hidden');
                
                document.getElementById('user-name-display').innerText = currentUserData.name || "Сотрудник";
                document.getElementById('user-discord-display').innerText = `Discord ID: ${currentUserData.discordId || "—"}`;
                document.getElementById('user-role-display').innerText = ROLES_LANG[currentUserData.role] || currentUserData.role;
                
                const tabStaff = document.getElementById('tab-staff');
                if (APPROVER_ROLES.includes(currentUserData.role)) {
                    tabStaff.classList.remove('hidden');
                } else {
                    tabStaff.classList.add('hidden');
                }
                
                switchDashboardTab('appeals');
                loadAppeals();
                
                if (APPROVER_ROLES.includes(currentUserData.role)) {
                    loadStaffList();
                }
                showSection('dashboard');
            } else {
                alert("Ошибка: Профиль сотрудника отсутствует в Firestore.");
                signOut(auth);
            }
        } catch (err) {
            console.error("Ошибка при получении профиля: ", err);
        }
    } else {
        currentUserData = null;
        hideEmployeeUI();
        showSection('home');
    }
});

function hideEmployeeUI() {
    document.getElementById('nav-login').classList.remove('hidden');
    document.getElementById('nav-logout').classList.add('hidden');
    document.getElementById('nav-dashboard').classList.add('hidden');
}

function setupPendingLogout() {
    const btn = document.getElementById('btn-pending-logout');
    if (btn) btn.onclick = () => signOut(auth);
}

document.getElementById('nav-logout').addEventListener('click', () => signOut(auth));

// === ЗАГРУЗКА ПУБЛИЧНОГО СОСТАВА ПРОКУРАТУРЫ ===
window.loadPublicStaff = async () => {
    const container = document.getElementById('publicStaffList');
    if (!container) return;
    
    container.innerHTML = "<div style='grid-column: 1 / -1; text-align: center; padding: 40px;'><span class='status-icon'>⏳</span><br>Загрузка данных из реестра...</div>";
    
    try {
        const querySnapshot = await getDocs(collection(db, "users"));
        container.innerHTML = "";
        
        let staffMembers = [];
        querySnapshot.forEach(doc => {
            const u = doc.data();
            if (u.isVerified) {
                staffMembers.push(u);
            }
        });

        if (staffMembers.length === 0) {
            container.innerHTML = "<div style='grid-column: 1 / -1; text-align: center; color: var(--color-muted);'>На данный момент реестр сотрудников пуст.</div>";
            return;
        }

        staffMembers.sort((a, b) => (ROLE_PRIORITY[a.role] || 99) - (ROLE_PRIORITY[b.role] || 99));

        staffMembers.forEach(member => {
            const name = member.name || "Неизвестный сотрудник";
            const roleName = ROLES_LANG[member.role] || member.role;
            
            container.innerHTML += `
                <div class="staff-card">
                    <div class="staff-avatar">🛡️</div>
                    <div class="staff-name">${name}</div>
                    <div class="staff-role">${roleName}</div>
                </div>
            `;
        });
        
    } catch (error) {
        container.innerHTML = `<div style='grid-column: 1 / -1; text-align: center; color: var(--color-danger);'>Ошибка загрузки: ${error.message}</div>`;
    }
};

// === ПОДАЧА ОБРАЩЕНИЯ ===
const appealForm = document.getElementById('appealForm');
if (appealForm) {
    appealForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = document.getElementById('appealName').value;
        const text = document.getElementById('appealText').value;
        const evidence = document.getElementById('appealEvidence').value;
        const statusDiv = document.getElementById('appealStatus');

        statusDiv.className = "status-msg";
        statusDiv.innerText = "Формирование электронного дела...";

        try {
            await addDoc(collection(db, "appeals"), {
                name: name,
                text: text,
                evidence: evidence,
                status: "pending",
                timestamp: serverTimestamp()
            });

            if (DISCORD_WEBHOOK_URL && DISCORD_WEBHOOK_URL.startsWith("https://")) {
                const payload = {
                    embeds: [{
                        title: "🚨 Зарегистрировано официальное обращение",
                        color: 13411380,
                        fields: [
                            { name: "Заявитель", value: name, inline: true },
                            { name: "Статус дела", value: "Ожидает рассмотрения ⏳", inline: true },
                            { name: "Содержание обращения", value: text },
                            { name: "Доказательства нарушения", value: evidence }
                        ],
                        timestamp: new Date().toISOString()
                    }]
                };

                await fetch(DISCORD_WEBHOOK_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                }).catch(e => console.error("Ошибка вебхука:", e));
            }

            statusDiv.className = "status-msg success";
            statusDiv.innerText = "Ваше обращение принято, зарегистрировано и отправлено на рассмотрение.";
            appealForm.reset();
        } catch (error) {
            statusDiv.className = "status-msg error";
            statusDiv.innerText = "Сбой: " + error.message;
        }
    });
}

// === РЕГИСТРАЦИЯ (ЧЕРЕЗ DISCORD ID) ===
const registerForm = document.getElementById('registerForm');
if (registerForm) {
    registerForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = document.getElementById('regName').value;
        const discordId = document.getElementById('regDiscordId').value.trim();
        const password = document.getElementById('regPassword').value;

        // Валидация числового ID дискорда
        if (!/^\d+$/.test(discordId)) {
            alert("Discord ID должен состоять только из цифр!");
            return;
        }

        const simulatedEmail = discordId + DISCORD_EMAIL_SUFFIX;

        try {
            const userCred = await createUserWithEmailAndPassword(auth, simulatedEmail, password);
            
            await setDoc(doc(db, "users", userCred.user.uid), {
                name: name,
                discordId: discordId,
                role: "assistant_prosecutor",
                isVerified: false
            });
            
            alert("Заявка создана. Ожидайте верификации руководством.");
            registerForm.reset();
        } catch (error) {
            alert("Ошибка регистрации: " + error.message);
        }
    });
}

// === ВХОД (ЧЕРЕЗ DISCORD ID) ===
const loginForm = document.getElementById('loginForm');
if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const discordId = document.getElementById('loginDiscordId').value.trim();
        const password = document.getElementById('loginPassword').value;

        const simulatedEmail = discordId + DISCORD_EMAIL_SUFFIX;

        try {
            await signInWithEmailAndPassword(auth, simulatedEmail, password);
        } catch (error) {
            alert("Ошибка входа: Убедитесь в правильности Discord ID и пароля. " + error.message);
        }
    });
}

// === ЗАГРУЗКА ОБРАЩЕНИЙ В ПАНЕЛЬ УПРАВЛЕНИЯ ===
async function loadAppeals() {
    const container = document.getElementById('appealsList');
    if (!container) return;
    container.innerHTML = "<div class='text-center'>Синхронизация...</div>";

    try {
        const querySnapshot = await getDocs(collection(db, "appeals"));
        container.innerHTML = "";

        if (querySnapshot.empty) {
            container.innerHTML = "<div class='text-center' style='color: var(--color-muted);'>Обращений нет.</div>";
            return;
        }

        const items = [];
        querySnapshot.forEach(d => items.push({ id: d.id, ...d.data() }));
        items.sort((a, b) => (b.timestamp?.seconds || 0) - (a.timestamp?.seconds || 0));

        items.forEach((data) => {
            const canReview = REVIEWER_ROLES.includes(currentUserData.role);
            let statusLabel = "Ожидает рассмотрения";
            if (data.status === "approved") statusLabel = "В работе / Одобрено";
            if (data.status === "rejected") statusLabel = "Отклонено";

            const card = document.createElement('div');
            card.className = `appeal-item status-${data.status}`;
            
            let actionsBlock = '';
            if (canReview && data.status === "pending") {
                actionsBlock = `
                    <div class="action-row">
                        <button class="btn btn-sm btn-approve" onclick="updateAppealState('${data.id}', 'approved', '${data.name.replace(/'/g, "\'")}')">Одобрить</button>
                        <button class="btn btn-sm btn-reject" onclick="updateAppealState('${data.id}', 'rejected', '${data.name.replace(/'/g, "\'")}')">Отклонить</button>
                    </div>
                `;
            }

            const evidenceHtml = data.evidence 
                ? `<div class="appeal-evidence-box"><strong>Доказательства:</strong> <a href="${data.evidence}" target="_blank">${data.evidence}</a></div>`
                : `<div class="appeal-evidence-box" style="color: var(--color-danger)">Доказательства отсутствуют</div>`;

            card.innerHTML = `
                <div class="appeal-meta">
                    <span class="appeal-author">Заявитель: ${data.name}</span>
                    <span>Статус: <strong>${statusLabel}</strong></span>
                </div>
                <div class="appeal-body">${data.text}</div>
                ${evidenceHtml}
                ${actionsBlock}
            `;
            container.appendChild(card);
        });
    } catch (error) {
        container.innerHTML = "<div class='text-center' style='color: var(--color-danger);'>Ошибка загрузки: " + error.message + "</div>";
    }
}

// === ИЗМЕНЕНИЕ СТАТУСА ОБРАЩЕНИЯ С ОТЧЕТОМ И УПОМИНАНИЕМ ===
window.updateAppealState = async (id, state, applicantName) => {
    if (!currentUserData || !currentUserData.discordId) {
        alert("Ошибка: Не найден ваш Discord ID для подписи.");
        return;
    }

    try {
        await updateDoc(doc(db, "appeals", id), { status: state });
        
        // Отправка вебхука с упоминанием прокурора
        if (DISCORD_WEBHOOK_URL && DISCORD_WEBHOOK_URL.startsWith("https://")) {
            const isApproved = state === "approved";
            const statusText = isApproved ? "🟢 ОДОБРЕНО И ВЗЯТО В РАБОТУ" : "🔴 ОТКЛОНЕНО";
            const colorCode = isApproved ? 3066993 : 15158332; // Зеленый или Красный

            // Пинг через синтаксис <@id>
            const prosecutorMention = `<@${currentUserData.discordId}>`;
            const prosecutorName = currentUserData.name || "Сотрудник";

            const payload = {
                content: `⚖️ **Отчетность по обращению граждан** | Дело #${id.substring(0, 6).toUpperCase()}`,
                embeds: [{
                    title: `Изменение статуса электронного обращения`,
                    color: colorCode,
                    fields: [
                        { name: "Заявитель", value: applicantName, inline: true },
                        { name: "Вердикт", value: statusText, inline: true },
                        { name: "Проверяющий прокурор", value: `${prosecutorName} (${prosecutorMention})`, inline: false }
                    ],
                    footer: { text: "Логирование внутренних решений органов юстиции" },
                    timestamp: new Date().toISOString()
                }]
            };

            await fetch(DISCORD_WEBHOOK_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            }).catch(e => console.error("Ошибка вебхука отчетности:", e));
        }

        alert("Статус дела успешно обновлен. Отчет отправлен в Discord.");
        loadAppeals();
    } catch (error) {
        alert("Ошибка смены статуса: " + error.message);
    }
};

// === ПАНЕЛЬ СОТРУДНИКОВ ===
async function loadStaffList() {
    const tbody = document.getElementById('staffList');
    if (!tbody) return;
    tbody.innerHTML = "<tr><td colspan='5' class='text-center'>Загрузка реестра...</td></tr>";

    try {
        const querySnapshot = await getDocs(collection(db, "users"));
        tbody.innerHTML = "";

        let usersArr = [];
        querySnapshot.forEach(docSnap => {
            usersArr.push({ id: docSnap.id, ...docSnap.data() });
        });
        
        usersArr.sort((a, b) => {
            if (a.isVerified !== b.isVerified) return a.isVerified ? 1 : -1;
            return (ROLE_PRIORITY[a.role] || 99) - (ROLE_PRIORITY[b.role] || 99);
        });

        usersArr.forEach((uData) => {
            const tr = document.createElement('tr');
            const badge = uData.isVerified 
                ? `<span class="status-badge verified">Активен</span>` 
                : `<span class="status-badge unverified">В очереди</span>`;

            let roleControl = '';
            if (currentUserData.role === 'governor') {
                roleControl = `<select onchange="changeStaffRole('${uData.id}', this.value)">`;
                for (const [key, value] of Object.entries(ROLES_LANG)) {
                    const selected = uData.role === key ? 'selected' : '';
                    roleControl += `<option value="${key}" ${selected}>${value}</option>`;
                }
                roleControl += `</select>`;
            } else {
                roleControl = ROLES_LANG[uData.role] || uData.role;
            }

            let actionsControl = '-';
            if (!uData.isVerified) {
                actionsControl = `<button class="btn btn-sm btn-gold" onclick="verifyStaffAccount('${uData.id}')">Одобрить</button>`;
            } else if (currentUserData.role === 'governor') {
                actionsControl = `<span style="color: var(--color-muted); font-size: 0.85rem;">Доступно ред.</span>`;
            }

            tr.innerHTML = `
                <td><strong>${uData.name || "Не указано"}</strong></td>
                <td><code>${uData.discordId || "—"}</code></td>
                <td>${badge}</td>
                <td>${roleControl}</td>
                <td>${actionsControl}</td>
            `;
            tbody.appendChild(tr);
        });
    } catch (error) {
        tbody.innerHTML = `<tr><td colspan='5' class='text-center' style='color: var(--color-danger);'>Ошибка доступа: ${error.message}</td></tr>`;
    }
}

window.verifyStaffAccount = async (uid) => {
    if (!APPROVER_ROLES.includes(currentUserData.role)) {
        alert("Нет полномочий.");
        return;
    }
    try {
        await updateDoc(doc(db, "users", uid), { isVerified: true });
        alert("Аккаунт активирован.");
        loadStaffList();
    } catch (error) {
        alert("Ошибка активации: " + error.message);
    }
};

window.changeStaffRole = async (uid, newRole) => {
    if (currentUserData.role !== 'governor') {
        alert("Только Губернатор.");
        return;
    }
    try {
        await updateDoc(doc(db, "users", uid), { role: newRole });
        alert("Должность обновлена.");
        loadStaffList();
    } catch (error) {
        alert("Ошибка обновления: " + error.message);
    }
};
