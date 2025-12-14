# Проект микросервисной архитектуры "СистемаКонтроля"
### Никитин Артемий Викторович ЭФБО-10-23
  
Этот проект представляет собой бэкенд-систему, разработанную в рамках учебного задания. Система построена на основе микросервисной архитектуры и включает три основных компонента: API-шлюз, сервис пользователей и сервис заказов.
## Описание архитектуры
- **`api_gateway`**: Единая точка входа для всех клиентских запросов. Отвечает за маршрутизацию, аутентификацию (проверку JWT), ограничение частоты запросов (rate limiting) и трассировку.
- **`service_users`**: Сервис для управления пользователями. Реализует регистрацию, вход (выдачу JWT) и управление профилями.
- **`service_orders`**: Сервис для управления заказами. Позволяет создавать и просматривать заказы, с проверкой прав доступа на уровне пользователя.
Все сервисы разработаны на Node.js с использованием фреймворка Express и запускаются в отдельных Docker-контейнерах. Оркестрация контейнеров осуществляется с помощью `docker-compose`.
## Быстрый старт
### Требования
- [Docker](https://www.docker.com/get-started/)
- [Docker Compose](https://docs.docker.com/compose/install/)
- `curl` и `jq` для выполнения тестовых запросов.
### Запуск проекта
1. Клонируйте репозиторий (если вы этого еще не сделали).
2. Перейдите в директорию `micro-task-template`.
3. Выполните команду для сборки и запуска всех сервисов в фоновом режиме:
  
```bash
docker compose up --build -d
```
### Остановка проекта
Для остановки и удаления контейнеров выполните:
```bash
docker compose down
```
## Тестирование API
Для проверки работоспособности API выполните следующие шаги в вашем терминале.
# Инструкция по тестированию API
## Шаг 1: Установка переменных окружения
```bash
export API_URL="http://localhost:8000/v1"
export TEST_EMAIL="user-test-$(date +%s)@example.com"
export TEST_PASSWORD="securePassword123"
export JSON_PRETTY_PRINT="| jq"
```

---

## Шаг 2: Регистрация и аутентификация
### 1. Регистрация нового пользователя
- **Описание:** Создает нового пользователя с уникальным email.
- **Команда:**
```bash
curl -s -X POST "${API_URL}/auth/register" \
-H "Content-Type: application/json" \
-d '{
"name": "Test User",
"email": "'"${TEST_EMAIL}"'",
"password": "'"${TEST_PASSWORD}"'"
}' $JSON_PRETTY_PRINT
```
<img width="767" height="121" alt="изображение" src="https://github.com/user-attachments/assets/e2b55232-8153-4e20-bb39-74246b916321" />


### 2. Попытка повторной регистрации
- **Описание:** Пытается создать пользователя с тем же email, что и на предыдущем шаге.
- **Команда:**
```bash
curl -s -X POST "${API_URL}/auth/register" \
-H "Content-Type: application/json" \
-d '{
"name": "Another User",
"email": "'"${TEST_EMAIL}"'",
"password": "anotherpassword"
}' $JSON_PRETTY_PRINT
```
<img width="920" height="132" alt="изображение" src="https://github.com/user-attachments/assets/bdee5ec6-f055-407b-ac06-69f4fdd14af1" />


### 3. Вход пользователя (логин)
- **Описание:** Использует данные ранее зарегистрированного пользователя для входа.
- **Команда:**
```bash
export AUTH_TOKEN=$(curl -s -X POST "${API_URL}/auth/login" \
-H "Content-Type: application/json" \
-d '{
"email": "'"${TEST_EMAIL}"'",
"password": "'"${TEST_PASSWORD}"'"
}' | jq -r .token | tr -d '\n')
echo "Токен получен: $AUTH_TOKEN"
```
<img width="919" height="145" alt="изображение" src="https://github.com/user-attachments/assets/3a112208-22f3-4a11-917e-779dee49749b" />

## Шаг 3: Доступ к защищенным ресурсам
### 4. Доступ к профилю без токена
- **Команда:**
```bash
curl -s -i -X GET "${API_URL}/users/profile"
```
<img width="724" height="228" alt="изображение" src="https://github.com/user-attachments/assets/4719861e-7787-4f9e-ac54-69e768be01cf" />

### 5. Доступ к профилю с валидным токеном
- **Команда:**
```bash
curl -s -X GET "${API_URL}/users/profile" \
-H "Authorization: Bearer ${AUTH_TOKEN}" $JSON_PRETTY_PRINT
```
<img width="901" height="62" alt="изображение" src="https://github.com/user-attachments/assets/3e84a225-6367-4ab6-a55c-3f122e7f665b" />

---

## Шаг 4: Работа с заказами
### 6. Создание заказа
- **Описание:** Создает новый заказ и автоматически сохраняет его ID в переменную `ORDER_ID`.
- **Команда:**
```bash
export PRODUCT_ID=$(uuidgen)
export ORDER_ID=$(curl -s -X POST "${API_URL}/orders" \
-H "Content-Type: application/json" \
-H "Authorization: Bearer ${AUTH_TOKEN}" \
-d '{
"items": [
{ "productId": "'"$PRODUCT_ID"'", "quantity": 2 }
],
"totalAmount": 150.50
}' | jq -r .id)
echo "ID созданного заказа: $ORDER_ID"
```
<img width="598" height="181" alt="изображение" src="https://github.com/user-attachments/assets/809524e2-f1b4-45fc-acb6-7030cfa2ce86" />

### 7. Получение списка заказов
- **Описание:** Получает все заказы для текущего пользователя.
- **Команда:**
```bash
curl -s -X GET "${API_URL}/orders" \
-H "Authorization: Bearer ${AUTH_TOKEN}" $JSON_PRETTY_PRINT
```
<img width="917" height="73" alt="изображение" src="https://github.com/user-attachments/assets/87e92d9e-cb5d-4592-886c-abf27eae35f1" />

### 8. Получение конкретного заказа по ID
- **Описание:** Получает созданный ранее заказ, используя захваченный `ORDER_ID`.
- **Команда:**
```bash
curl -s -X GET "${API_URL}/orders/${ORDER_ID}" \
-H "Authorization: Bearer ${AUTH_TOKEN}" $JSON_PRETTY_PRINT
```
<img width="910" height="70" alt="изображение" src="https://github.com/user-attachments/assets/8dbb0f4b-f9b5-4cf3-913b-c473ce003bce" />

### 9. Попытка получения чужого заказа
- **Описание:** Пытается получить заказ, используя случайный UUID.
- **Команда:**
```bash
curl -s -i -X GET "${API_URL}/orders/$(uuidgen)" \
-H "Authorization: Bearer ${AUTH_TOKEN}"
```
<img width="721" height="224" alt="изображение" src="https://github.com/user-attachments/assets/7e5bd318-9bff-4bc2-840b-6df12be16427" />
