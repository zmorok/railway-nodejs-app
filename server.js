const express = require('express')
const { engine } = require('express-handlebars')
const Handlebars = require('handlebars')
const fs = require('fs')
const path = require('path')

const app = express()
const PORT = process.env.PORT || 3000

const LOCAL_DATA_FILE = path.join(__dirname, 'data.json')

const INITIAL_RECORDS = [
	{ id: '1', name: 'Иван Иванов', phone: '+375291111111' },
	{ id: '2', name: 'Пётр Петров', phone: '+375292222222' },
]

const BLOCK_HASH =
	'211d0bb8cf4f5b5202c2a9b7996e483898644aa24714b1e10edd80a54ba4b560'

const CLEAN_HASH =
	'5137c8760c9411860cdc0eccf0e2e3ae66cc0379c45c89104b477351d3cce57f'

const GITHUB_API = 'https://api.github.com'
const GITHUB_TOKEN = process.env.GITHUB_TOKEN
const GITHUB_OWNER = process.env.GITHUB_OWNER
const GITHUB_REPO = process.env.GITHUB_REPO
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || 'main'
const GITHUB_DATA_PATH = process.env.GITHUB_DATA_PATH || 'storage/data.json'

const USE_GITHUB_STORAGE = Boolean(GITHUB_TOKEN && GITHUB_OWNER && GITHUB_REPO)

function cloneInitialRecords() {
	return INITIAL_RECORDS.map(record => ({ ...record }))
}

function createInitialPhonebook() {
	return {
		records: cloneInitialRecords(),
		isBlocked: false,
	}
}

function normalizeRecord(record) {
	return {
		id: String(record.id),
		name: String(record.name || '').trim(),
		phone: String(record.phone || '').trim(),
	}
}

function normalizePhonebook(data) {
	const records = Array.isArray(data?.records)
		? data.records
				.map(normalizeRecord)
				.filter(record => record.id && record.name && record.phone)
		: cloneInitialRecords()

	return {
		records,
		isBlocked: Boolean(data?.isBlocked),
	}
}

function readLocalPhonebook() {
	if (!fs.existsSync(LOCAL_DATA_FILE)) {
		writeLocalPhonebook(createInitialPhonebook())
	}

	try {
		const raw = fs.readFileSync(LOCAL_DATA_FILE, 'utf8')
		return normalizePhonebook(JSON.parse(raw || '{}'))
	} catch (error) {
		console.error('Local data read error:', error)
		return createInitialPhonebook()
	}
}

function writeLocalPhonebook(data) {
	fs.writeFileSync(
		LOCAL_DATA_FILE,
		JSON.stringify(normalizePhonebook(data), null, 2),
		'utf8',
	)
}

function getGithubFilePath() {
	return GITHUB_DATA_PATH.split('/').map(encodeURIComponent).join('/')
}

function getGithubFileUrl() {
	return `${GITHUB_API}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${getGithubFilePath()}`
}

async function githubRequest(url, options = {}) {
	const { allow404 = false, headers = {}, ...fetchOptions } = options

	if (typeof fetch !== 'function') {
		throw new Error(
			'Для GitHub-хранилища нужен Node.js 18 или новее, потому что используется fetch().',
		)
	}

	const response = await fetch(url, {
		...fetchOptions,
		headers: {
			Accept: 'application/vnd.github+json',
			Authorization: `Bearer ${GITHUB_TOKEN}`,
			'X-GitHub-Api-Version': '2022-11-28',
			...headers,
		},
	})

	if (allow404 && response.status === 404) {
		return null
	}

	if (!response.ok) {
		const text = await response.text()
		throw new Error(`GitHub API error ${response.status}: ${text}`)
	}

	return response.json()
}

function encodeBase64Utf8(value) {
	return Buffer.from(value, 'utf8').toString('base64')
}

function decodeBase64Utf8(value) {
	return Buffer.from(String(value).replace(/\n/g, ''), 'base64').toString(
		'utf8',
	)
}

async function getGithubFile() {
	const url = `${getGithubFileUrl()}?ref=${encodeURIComponent(GITHUB_BRANCH)}`
	return githubRequest(url, { allow404: true })
}

async function readGithubPhonebook() {
	const file = await getGithubFile()

	if (!file?.content) {
		return createInitialPhonebook()
	}

	try {
		const raw = decodeBase64Utf8(file.content)
		return normalizePhonebook(JSON.parse(raw || '{}'))
	} catch (error) {
		console.error('GitHub data parse error:', error)
		return createInitialPhonebook()
	}
}

async function writeGithubPhonebook(data) {
	const currentFile = await getGithubFile()
	const phonebook = normalizePhonebook(data)

	const body = {
		message: 'Update phonebook data',
		content: encodeBase64Utf8(JSON.stringify(phonebook, null, 2)),
		branch: GITHUB_BRANCH,
	}

	if (currentFile?.sha) {
		body.sha = currentFile.sha
	}

	await githubRequest(getGithubFileUrl(), {
		method: 'PUT',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify(body),
	})
}

async function readPhonebook() {
	if (USE_GITHUB_STORAGE) {
		return readGithubPhonebook()
	}

	return readLocalPhonebook()
}

async function writePhonebook(data) {
	if (USE_GITHUB_STORAGE) {
		await writeGithubPhonebook(data)
		return
	}

	writeLocalPhonebook(data)
}

function createId(records) {
	const maxId = records.reduce((max, item) => {
		const numericId = Number(item.id)
		return Number.isFinite(numericId) && numericId > max ? numericId : max
	}, 0)

	return String(maxId + 1)
}

function asyncHandler(handler) {
	return (req, res, next) => {
		Promise.resolve(handler(req, res, next)).catch(next)
	}
}

async function renderIndex(req, res) {
	const phonebook = await readPhonebook()

	res.render('index', {
		title: 'Телефонный справочник',
		records: phonebook.records,
	})
}

// hbs
app.engine(
	'hbs',
	engine({
		extname: '.hbs',
		defaultLayout: 'main',
		layoutsDir: path.join(__dirname, 'views', 'layouts'),
		partialsDir: path.join(__dirname, 'views', 'partials'),
		helpers: {
			cancelButton() {
				return new Handlebars.SafeString(
					'<a class="button button-secondary" href="/">Отказаться</a>',
				)
			},
		},
	}),
)

app.set('view engine', 'hbs')
app.set('views', path.join(__dirname, 'views'))

// static
app.use(express.urlencoded({ extended: false }))
app.use(express.static(path.join(__dirname, 'public')))

app.get(
	'/pupa',
	asyncHandler(async (req, res) => {
		const hash = String(req.query.hash || '')

		if (!hash) {
			return res.send(`
				<!doctype html>
				<html lang="ru">
					<head>
						<meta charset="utf-8" />
						<title>BlockAndClean</title>
					</head>
					<body>
						<script>
							async function sha256(text) {
								const data = new TextEncoder().encode(text)
								const hashBuffer = await crypto.subtle.digest('SHA-256', data)
								const hashArray = Array.from(new Uint8Array(hashBuffer))

								return hashArray
									.map(byte => byte.toString(16).padStart(2, '0'))
									.join('')
							}

							;(async () => {
								const value = prompt('Введите команду')

								if (value === null) {
									location.href = '/'
									return
								}

								const hash = await sha256(value)
								location.href = '/pupa?hash=' + encodeURIComponent(hash)
							})()
						</script>
					</body>
				</html>
			`)
		}

		if (hash === BLOCK_HASH) {
			const phonebook = await readPhonebook()
			phonebook.isBlocked = !phonebook.isBlocked
			await writePhonebook(phonebook)

			return res.send(`
				<h1>BlockAndClean</h1>
				<p>Состояние сервера: <b>${
					phonebook.isBlocked ? 'заблокирован' : 'разблокирован'
				}</b></p>
				<a href="/pupa">Ввести команду снова</a>
				<br />
				<a href="/">На главную</a>
			`)
		}

		if (hash === CLEAN_HASH) {
			const phonebook = await readPhonebook()
			phonebook.records = cloneInitialRecords()
			await writePhonebook(phonebook)

			return res.send(`
				<h1>BlockAndClean</h1>
				<p>Справочник очищен до первоначального состояния.</p>
				<a href="/pupa">Ввести команду снова</a>
				<br />
				<a href="/">На главную</a>
			`)
		}

		res.status(403).send(`
			<h1>Ошибка</h1>
			<p>Неверная команда.</p>
			<a href="/pupa">Попробовать снова</a>
		`)
	}),
)

app.use(
	asyncHandler(async (req, res, next) => {
		if (req.path === '/pupa') {
			return next()
		}

		const phonebook = await readPhonebook()

		if (phonebook.isBlocked) {
			return res.status(423).send(`
				<h1>Сервер заблокирован</h1>
				<p>Все основные эндпоинты временно не обрабатываются.</p>
				<p>Для разблокировки откройте <a href="/pupa">/pupa</a> и введите команду.</p>
			`)
		}

		next()
	}),
)

// GET - вернуть страницу
app.get('/', asyncHandler(renderIndex))

// GET ADD - получить все номера
app.get(
	'/Add',
	asyncHandler(async (req, res) => {
		const phonebook = await readPhonebook()

		res.render('add', {
			title: 'Добавление записи',
			records: phonebook.records,
		})
	}),
)

// POST ADD - добавить новый номер
app.post(
	'/Add',
	asyncHandler(async (req, res) => {
		const phonebook = await readPhonebook()
		const record = normalizeRecord({
			id: createId(phonebook.records),
			name: req.body.name,
			phone: req.body.phone,
		})

		if (record.name && record.phone) {
			phonebook.records.push(record)
			await writePhonebook(phonebook)
		}

		res.redirect('/')
	}),
)

// GET UPDATE - получить поле изменения выбранного номера
app.get(
	'/Update',
	asyncHandler(async (req, res) => {
		const phonebook = await readPhonebook()
		const selectedId = String(req.query.id || '')
		const selectedRecord = phonebook.records.find(
			record => String(record.id) === selectedId,
		)

		if (!selectedRecord) {
			return res.redirect('/')
		}

		res.render('update', {
			title: 'Изменение записи',
			records: phonebook.records,
			record: selectedRecord,
			updateMode: true,
		})
	}),
)

// POST UPDATE - отправка изменений выбранного номера
app.post(
	'/Update',
	asyncHandler(async (req, res) => {
		const phonebook = await readPhonebook()
		const targetId = String(req.body.id || '')
		const recordIndex = phonebook.records.findIndex(
			record => String(record.id) === targetId,
		)

		if (recordIndex !== -1) {
			const updatedRecord = normalizeRecord({
				id: targetId,
				name: req.body.name,
				phone: req.body.phone,
			})

			if (updatedRecord.name && updatedRecord.phone) {
				phonebook.records[recordIndex] = updatedRecord
				await writePhonebook(phonebook)
			}
		}

		res.redirect('/')
	}),
)

// POST DELETE - отправка удаления выбранного номера
app.post(
	'/Delete',
	asyncHandler(async (req, res) => {
		const phonebook = await readPhonebook()
		const targetId = String(req.body.id || '')

		phonebook.records = phonebook.records.filter(
			record => String(record.id) !== targetId,
		)

		await writePhonebook(phonebook)
		res.redirect('/')
	}),
)

app.use((req, res) => {
	res.status(404).send('Route not found')
})

app.use((error, req, res, next) => {
	console.error(error)

	if (res.headersSent) {
		return next(error)
	}

	res.status(500).send(`
		<h1>Server error</h1>
		<p>Проверьте логи деплоя и переменные окружения GitHub.</p>
	`)
})

if (process.env.VERCEL) {
	module.exports = app
} else {
	app.listen(PORT, () => {
		console.log(`Express app started at http://localhost:${PORT}/`)
	})
}
