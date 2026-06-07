const express = require('express');
const cors = require('cors');
const mysql = require('mysql2');
const path = require('path');
const bcrypt = require('bcryptjs');
const webpush = require('web-push');

// Podešavanje Web Push Notifikacija (VAPID ključevi)
const publicVapidKey = process.env.VAPID_PUBLIC_KEY || 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuB3IQ-lcI8w8G18O_QG219gE8';
const privateVapidKey = process.env.VAPID_PRIVATE_KEY || 'K_fCxyxQv3f_u62Y1jTxyAOhD6D5_sT_yZ7z1g0D5Fk';
webpush.setVapidDetails('mailto:info@totalfit.com', publicVapidKey, privateVapidKey);

const app = express();
const PORT = process.env.PORT || 5001;

app.use(cors());
app.use(express.json());

// REWRITE MIDDLEWARE: Preusmerava frontend /app/api zahteve na originalne /api rute
app.use((req, res, next) => {
    if (req.url.startsWith('/app/api/')) {
        req.url = req.url.replace('/app/api/', '/api/');
    }
    next();
});

// Svi fajlovi iz 'public' foldera se sada serviraju na putanji /app
app.use('/app', express.static(path.join(__dirname, 'public')));

// Automatska redirekcija sa osnovnog domena (npr. viennafit.com) na /app
app.get('/', (req, res) => res.redirect('/app'));

// Povezivanje sa MySQL bazom podataka
const db = mysql.createPool({
    host: (process.env.DB_HOST && process.env.DB_HOST !== 'localhost') ? process.env.DB_HOST : '127.0.0.1',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'klub_baza',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

db.getConnection((err, conn) => {
    if (err) console.error('Greška pri spajanju na MySQL bazu:', err.message);
    else {
        console.log('Povezan na MySQL bazu.');
        conn.release();
    }
});

// Inicijalizacija tabela pri pokretanju
const initSql = [
    `CREATE TABLE IF NOT EXISTS clanovi (
        id INT AUTO_INCREMENT PRIMARY KEY,
        ime_prezime VARCHAR(255) NOT NULL,
        email VARCHAR(255) UNIQUE,
        telefon VARCHAR(50),
        pol VARCHAR(20),
        datum_rodjenja VARCHAR(50),
        datum_upisa VARCHAR(50) NOT NULL,
        clanarina_vrijedi_do VARCHAR(50),
        adresa VARCHAR(255),
        grad VARCHAR(255),
        postanski_broj VARCHAR(50),
        drzava VARCHAR(50) DEFAULT 'AT',
        status VARCHAR(50) DEFAULT 'Aktivan',
        napomena TEXT,
        fitness TINYINT DEFAULT 0,
        bjj TINYINT DEFAULT 0,
        korisnicko_ime VARCHAR(100) UNIQUE,
        lozinka VARCHAR(255),
        push_pretplata TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS poruke (
        id INT AUTO_INCREMENT PRIMARY KEY,
        clan_id INT,
        posiljalac VARCHAR(50),
        tekst TEXT NOT NULL,
        vreme TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        procitano TINYINT DEFAULT 0,
        FOREIGN KEY(clan_id) REFERENCES clanovi(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS grupne_poruke (
        id INT AUTO_INCREMENT PRIMARY KEY,
        naslov VARCHAR(255),
        tekst TEXT NOT NULL,
        filter VARCHAR(50) DEFAULT 'svi',
        vreme TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`
];

function kreirajTabele(index) {
    if (index >= initSql.length) return;
    db.query(initSql[index], (err) => {
        if (err) console.error('Greska pri kreiranju MySQL tabele:', err.message);
        kreirajTabele(index + 1); // Tek kad završi prvu, prelazi na sledeću
    });
}
kreirajTabele(0);

function kreirajKorisnickoIme(imePrezime) {
    return imePrezime.toLowerCase()
        .trim()
        .replace(/\s+/g, '.') // Sve razmake menja u tačku
        .replace(/đ/g, 'dj') // Specifična konverzija za đ
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // Skida sve kvačice (č->c, š->s...)
        .replace(/[^a-z0-9.]/g, ''); // Briše sve što nije slovo, broj ili tačka
}

// ==========================================================================
// RUTE ZA ČLANOVE (ADMIN)
// ==========================================================================

app.post('/api/admin/clanovi', (req, res) => {
    const { ime_prezime, email, telefon, pol, datum_rodjenja, datum_upisa, clanarina_vrijedi_do, adresa, grad, postanski_broj, drzava, status, napomena, fitness, bjj } = req.body;
    const korisnicko_ime = kreirajKorisnickoIme(ime_prezime);

    // Kriptovanje lozinke pre upisa u bazu
    bcrypt.hash("totalfit123", 10, (err, hashLozinka) => {
        if (err) return res.status(500).json({ error: 'Greška pri kriptovanju lozinke.' });

        const sql = `INSERT INTO clanovi (ime_prezime, email, telefon, pol, datum_rodjenja, datum_upisa, clanarina_vrijedi_do, adresa, grad, postanski_broj, drzava, status, napomena, fitness, bjj, korisnicko_ime, lozinka) 
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
                     
        db.query(sql, [ime_prezime, email || null, telefon, pol, datum_rodjenja, datum_upisa, clanarina_vrijedi_do, adresa, grad, postanski_broj, drzava || 'AT', status || 'Aktivan', napomena, fitness, bjj, korisnicko_ime, hashLozinka], function(err, results) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ id: results.insertId, korisnicko_ime, message: "Član uspešno sačuvan!" });
        });
    });
});

app.get('/api/admin/clanovi', (req, res) => {
    db.query("SELECT * FROM clanovi ORDER BY ime_prezime ASC", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.put('/api/admin/clanovi/:id', (req, res) => {
    const { id } = req.params;
    const { ime_prezime, email, telefon, pol, datum_rodjenja, datum_upisa, clanarina_vrijedi_do, adresa, grad, postanski_broj, drzava, status, napomena, fitness, bjj } = req.body;
    
    const sql = `UPDATE clanovi SET 
                 ime_prezime = ?, email = ?, telefon = ?, pol = ?, datum_rodjenja = ?, 
                 datum_upisa = ?, clanarina_vrijedi_do = ?, adresa = ?, grad = ?, postanski_broj = ?, drzava = ?, status = ?, napomena = ?, 
                 fitness = ?, bjj = ? 
                 WHERE id = ?`;
                 
    db.query(sql, [ime_prezime, email || null, telefon, pol, datum_rodjenja, datum_upisa, clanarina_vrijedi_do, adresa, grad, postanski_broj, drzava, status, napomena, fitness, bjj, id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "Podaci uspešno ažurirani!" });
    });
});

app.get('/api/admin/statistika', (req, res) => {
    const danas = new Date().toISOString().split('T')[0];
    const sqlUkupno = "SELECT COUNT(*) as ukupno FROM clanovi";
    const sqlFitness = "SELECT COUNT(*) as fitness FROM clanovi WHERE fitness = 1 AND clanarina_vrijedi_do >= ?";
    const sqlBjj = "SELECT COUNT(*) as bjj FROM clanovi WHERE bjj = 1 AND clanarina_vrijedi_do >= ?";

    db.query(sqlUkupno, [], (err, rowUkupno) => {
        if (err) return res.status(500).json({ error: err.message });
        db.query(sqlFitness, [danas], (err, rowFitness) => {
            if (err) return res.status(500).json({ error: err.message });
            db.query(sqlBjj, [danas], (err, rowBjj) => {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ ukupno: rowUkupno[0] ? rowUkupno[0].ukupno : 0, fitness: rowFitness[0] ? rowFitness[0].fitness : 0, bjj: rowBjj[0] ? rowBjj[0].bjj : 0 });
            });
        });
    });
});

app.get('/api/admin/rodjendani-ovog-meseca', (req, res) => {
    const tekuciMesec = String(new Date().getMonth() + 1).padStart(2, '0');
    const sql = `SELECT ime_prezime, datum_rodjenja, pol FROM clanovi 
                 WHERE SUBSTRING(datum_rodjenja, 6, 2) = ? 
                 ORDER BY SUBSTRING(datum_rodjenja, 9, 2) ASC`;
    db.query(sql, [tekuciMesec], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// ==========================================================================
// RUTE ZA KOMUNIKACIJU
// ==========================================================================

// Slanje sa računara (ADMIN) -> posiljalac: 'admin'
app.post('/api/admin/poruke/individualna', (req, res) => {
    const { clan_id, tekst } = req.body;
    const sql = `INSERT INTO poruke (clan_id, posiljalac, tekst) VALUES (?, 'admin', ?)`;
    db.query(sql, [clan_id, tekst], function(err, results) {
        if (err) return res.status(500).json({ error: err.message });
        
        // Slanje Push Notifikacije klijentu
        db.query(`SELECT push_pretplata FROM clanovi WHERE id = ?`, [clan_id], (err, rows) => {
            const row = rows ? rows[0] : null;
            if (row && row.push_pretplata) {
                try {
                    const sub = JSON.parse(row.push_pretplata);
                    const payload = JSON.stringify({ naslov: 'Total Fit', tekst: tekst });
                    webpush.sendNotification(sub, payload).catch(e => console.error('Push greška:', e));
                } catch (e) {}
            }
        });

        res.json({ message: "Poruka poslata klijentu!", poruka_id: results.insertId });
    });
});

// Slanje sa mobilnog telefona (ČLAN) -> posiljalac: 'clan'
app.post('/api/admin/poruke/individualna-klijent', (req, res) => {
    const { clan_id, tekst } = req.body;
    const sql = `INSERT INTO poruke (clan_id, posiljalac, tekst) VALUES (?, 'clan', ?)`;
    db.query(sql, [clan_id, tekst], function(err, results) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "Poruka poslata klubu!", poruka_id: results.insertId });
    });
});

// Slanje klupskog grupnog obaveštenja
app.post('/api/admin/poruke/grupna', (req, res) => {
    const { naslov, tekst, filter } = req.body;
    const sql = `INSERT INTO grupne_poruke (naslov, tekst, filter) VALUES (?, ?, ?)`;
    db.query(sql, [naslov, tekst, filter || 'svi'], function(err, results) {
        if (err) return res.status(500).json({ error: err.message });
        
        // Slanje Push notifikacija svima koji odgovaraju filteru i imaju dozvoljen push
        let query = `SELECT push_pretplata FROM clanovi WHERE push_pretplata IS NOT NULL AND status = 'Aktivan'`;
        if (filter === 'fitness') query += ` AND fitness = 1`;
        if (filter === 'bjj') query += ` AND bjj = 1`;
        
        db.query(query, [], (err, rows) => {
            if (rows) {
                const payload = JSON.stringify({ naslov: naslov, tekst: tekst });
                rows.forEach(row => {
                    try {
                        const sub = JSON.parse(row.push_pretplata);
                        webpush.sendNotification(sub, payload).catch(e => console.error(e));
                    } catch(e) {}
                });
            }
        });

        res.json({ message: "Grupno obaveštenje poslato!", grupna_id: results.insertId });
    });
});

// Brisanje klupskog grupnog obaveštenja
app.delete('/api/admin/poruke/grupna/:id', (req, res) => {
    const { id } = req.params;
    db.query("DELETE FROM grupne_poruke WHERE id = ?", [id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "Obaveštenje obrisano!" });
    });
});

// Brisanje individualne poruke iz četa
app.delete('/api/admin/poruke/individualna/:id', (req, res) => {
    const { id } = req.params;
    db.query("DELETE FROM poruke WHERE id = ?", [id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "Poruka trajno obrisana!" });
    });
});

// Istorija razgovora za određenog člana
app.get('/api/admin/poruke/chat/:clan_id', (req, res) => {
    const { clan_id } = req.params;
    db.query("SELECT * FROM poruke WHERE clan_id = ? ORDER BY vreme ASC", [clan_id], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// Označi poruke kao pročitane
app.put('/api/admin/poruke/procitano/:clan_id', (req, res) => {
    const { clan_id } = req.params;
    db.query("UPDATE poruke SET procitano = 1 WHERE clan_id = ? AND posiljalac = 'clan'", [clan_id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "Poruke pročitane" });
    });
});

// Označi sve poruke kao pročitane
app.put('/api/admin/poruke/procitano-sve', (req, res) => {
    db.query("UPDATE poruke SET procitano = 1 WHERE posiljalac = 'clan'", [], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "Sve poruke pročitane" });
    });
});

// Dohvatanje svih klupskih obaveštenja
app.get('/api/admin/grupne-poruke-sve', (req, res) => {
    db.query("SELECT * FROM grupne_poruke ORDER BY id ASC", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// ==========================================================================
// RUTA ZA LOGIN KLIJENTA
// ==========================================================================

app.post('/api/login', (req, res) => {
    const { korisnicko_ime, lozinka } = req.body;

    if (!korisnicko_ime || !lozinka) {
        return res.status(400).json({ error: 'Korisničko ime i lozinka su obavezni.' });
    }

    const sql = `SELECT * FROM clanovi WHERE korisnicko_ime = ?`;
    db.query(sql, [korisnicko_ime], (err, rows) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        const clan = rows ? rows[0] : null;
        if (!clan) {
            return res.status(401).json({ error: 'Pogrešno korisničko ime ili lozinka.' });
        }

        // Upoređivanje unete lozinke sa kriptovanom iz baze
        bcrypt.compare(lozinka, clan.lozinka, (err, isMatch) => {
            if (err) return res.status(500).json({ error: err.message });
            if (!isMatch) {
                return res.status(401).json({ error: 'Pogrešno korisničko ime ili lozinka.' });
            }
            res.json({ id: clan.id, ime_prezime: clan.ime_prezime });
        });
    });
});

// Ruta za čuvanje push pretplate klijenta
app.post('/api/pretplata', (req, res) => {
    const { clan_id, pretplata } = req.body;
    if (!clan_id || !pretplata) return res.status(400).json({ error: 'Fale podaci.' });
    
    db.query(`UPDATE clanovi SET push_pretplata = ? WHERE id = ?`, [JSON.stringify(pretplata), clan_id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.status(201).json({ message: 'Pretplata sačuvana' });
    });
});

// ==========================================================================
// CATCH-ALL RUTA ZA FRONTEND (Mora biti na samom kraju!)
// ==========================================================================
app.get(/^\/app(\/.*)?$/, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => console.log(`Server trči na portu ${PORT}`));