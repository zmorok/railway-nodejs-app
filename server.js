const express = require('express')
const { engine } = require('express-handlebars')
const Handlebars = require('handlebars')
const fs = require('fs')
const path = require('path')

const app = express()
const PORT = process.env.PORT || 3000
const DATA_FILE = path.join(__dirname, 'data.json')
const INITIAL_RECORDS = [
	{ id: '1', name: 'Иван Иванов', phone: '+375291111111' },
	{ id: '2', name: 'Пётр Петров', phone: '+375292222222' },
]

const BLOCK_HASH =
	'211d0bb8cf4f5b5202c2a9b7996e483898644aa24714b1e10edd80a54ba4b560'

const CLEAN_HASH =
	'5137c8760c9411860cdc0eccf0e2e3ae66cc0379c45c89104b477351d3cce57f'

let isBlocked = false

function readPhonebook() {
	if (!fs.existsSync(DATA_FILE)) {
		fs.writeFileSync(
			DATA_FILE,
			JSON.stringify({ records: INITIAL_RECORDS }, null, 2),
			'utf8',
		)
	}

	const raw = fs.readFileSync(DATA_FILE, 'utf8')
	const parsed = JSON.parse(raw || '{ "records": [] }')

	if (!Array.isArray(parsed.records)) {
		return { records: INITIAL_RECORDS }
	}

	return parsed
}

function cleanPhonebook() {
	writePhonebook({ records: INITIAL_RECORDS })
}

function writePhonebook(data) {
	fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8')
}

function normalizeRecord(record) {
	return {
		id: String(record.id),
		name: String(record.name || '').trim(),
		phone: String(record.phone || '').trim(),
	}
}

function createId(records) {
	const maxId = records.reduce((max, item) => {
		const numericId = Number(item.id)
		return Number.isFinite(numericId) && numericId > max ? numericId : max
	}, 0)

	return String(maxId + 1)
}

function renderIndex(req, res) {
	const phonebook = readPhonebook()
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

app.get('/pupa', (req, res) => {
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
		isBlocked = !isBlocked

		return res.send(`
			<h1>BlockAndClean</h1>
			<p>Состояние сервера: <b>${isBlocked ? 'заблокирован' : 'разблокирован'}</b></p>
			<a href="/pupa">Ввести команду снова</a>
			<br />
			<a href="/">На главную</a>
		`)
	}

	if (hash === CLEAN_HASH) {
		cleanPhonebook()

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
})
app.use((req, res, next) => {
	if (req.path === '/pupa') {
		return next()
	}

	if (isBlocked) {
		return res.status(423).send(`
			<h1>Сервер заблокирован</h1>
			<p>Все основные эндпоинты временно не обрабатываются.</p>
		`)
	}

	next()
})

// GET - вернуть страницу
app.get('/', renderIndex)

// GET ADD - получить все номера
app.get('/Add', (req, res) => {
	const phonebook = readPhonebook()
	res.render('add', {
		title: 'Добавление записи',
		records: phonebook.records,
	})
})

// POST ADD - добавить новый номер
app.post('/Add', (req, res) => {
	const phonebook = readPhonebook()
	const record = normalizeRecord({
		id: createId(phonebook.records),
		name: req.body.name,
		phone: req.body.phone,
	})

	if (record.name && record.phone) {
		phonebook.records.push(record)
		writePhonebook(phonebook)
	}

	res.redirect('/')
})

// GET UPDATE - получить поле изменения выбранного номера
app.get('/Update', (req, res) => {
	const phonebook = readPhonebook()
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
})

// POST UPDATE - отправка изменений выбранного номера
app.post('/Update', (req, res) => {
	const phonebook = readPhonebook()
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
			writePhonebook(phonebook)
		}
	}

	res.redirect('/')
})

// POST DELETE - отправка удаления выбранного номера
app.post('/Delete', (req, res) => {
	const phonebook = readPhonebook()
	const targetId = String(req.body.id || '')
	phonebook.records = phonebook.records.filter(
		record => String(record.id) !== targetId,
	)
	writePhonebook(phonebook)
	res.redirect('/')
})

app.use((req, res) => {
	res.status(404).send('Route not found')
})

app.listen(PORT, () => {
	console.log(`Express app started at http://localhost:${PORT}/`)
})
