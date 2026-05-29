const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const webpush = require('web-push');
const fs = require('fs');

// Podešavanje Web Push Notifikacija (VAPID ključevi)
const publicVapidKey = 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuB3IQ-lcI8w8G18O_QG219gE8';
const privateVapidKey = 'K_fCxyxQv3f_u62Y1jTxyAOhD6D5_sT_yZ7z1g0D5Fk';
webpush.setVapidDetails('mailto:info@totalfit.com', publicVapidKey, privateVapidKey);

const app = express();
const PORT = process.env.PORT || 5001;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Povezivanje sa SQLite bazom podataka
// Za Glitch: Baza mora biti u .data folderu da se ne bi obrisala pri restartu
const dataDir = path.join(__dirname, '.data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir);
}
const dbPath = path.resolve(dataDir, 'baza.sqlite');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) console.error('Greška pri spajanju na bazu:', err.message);
    else console.log('Povezan na SQLite bazu.');
});

// Inicijalizacija tabela pri pokretanju
db.serialize(() => {
    // Tabela članova
    db.run(`CREATE TABLE IF NOT EXISTS clanovi (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ime_prezime TEXT NOT NULL,
        email TEXT UNIQUE,
        telefon TEXT,
        pol TEXT,
        datum_rodjenja TEXT,
        datum_upisa TEXT NOT NULL,
        clanarina_vrijedi_do TEXT,
        adresa TEXT,
        grad TEXT,
        postanski_broj TEXT,
        drzava TEXT DEFAULT 'AT',
        status TEXT DEFAULT 'Aktivan',
        napomena TEXT,
        fitness INTEGER DEFAULT 0,
        bjj INTEGER DEFAULT 0,
        korisnicko_ime TEXT UNIQUE,
        lozinka TEXT
    )`);

    // Tabela za individualni čet (Admin <-> Klijent)
    db.run(`CREATE TABLE IF NOT EXISTS poruke (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        clan_id INTEGER,
        posiljalac TEXT, -- 'admin' ili 'clan'
        tekst TEXT NOT NULL,
        vreme TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        procitano INTEGER DEFAULT 0,
        FOREIGN KEY(clan_id) REFERENCES clanovi(id)
    )`);

    // Tabela za grupna klupska obaveštenja
    db.run(`CREATE TABLE IF NOT EXISTS grupne_poruke (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        naslov TEXT,
        tekst TEXT NOT NULL,
        filter TEXT DEFAULT 'svi',
        vreme TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);
});

// Automatsko osiguranje kolona u slučaju da nedostaju
db.run(`ALTER TABLE clanovi ADD COLUMN fitness INTEGER DEFAULT 0`, () => {});
db.run(`ALTER TABLE clanovi ADD COLUMN bjj INTEGER DEFAULT 0`, () => {});
db.run(`ALTER TABLE clanovi ADD COLUMN pol TEXT`, () => {});
db.run(`ALTER TABLE clanovi ADD COLUMN korisnicko_ime TEXT`, () => {});
db.run(`ALTER TABLE clanovi ADD COLUMN lozinka TEXT`, () => {});
db.run(`ALTER TABLE clanovi ADD COLUMN adresa TEXT`, () => {});
db.run(`ALTER TABLE clanovi ADD COLUMN grad TEXT`, () => {});
db.run(`ALTER TABLE clanovi ADD COLUMN postanski_broj TEXT`, () => {});
db.run(`ALTER TABLE clanovi ADD COLUMN push_pretplata TEXT`, () => {});
db.run(`ALTER TABLE clanovi ADD COLUMN drzava TEXT DEFAULT 'AT'`, () => {
    // Automatski dodeli/popravi korisnička imena i lozinke svim postojećim članovima
    db.each(`SELECT id, ime_prezime, korisnicko_ime FROM clanovi`, (err, row) => {
        if (row) {
            const kIme = kreirajKorisnickoIme(row.ime_prezime);
            if (!row.korisnicko_ime || row.korisnicko_ime !== kIme) {
                db.run(`UPDATE clanovi SET korisnicko_ime = ?, lozinka = 'totalfit123' WHERE id = ?`, [kIme, row.id]);
            }
        }
    });
});

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
    const lozinka = "totalfit123";

    const sql = `INSERT INTO clanovi (ime_prezime, email, telefon, pol, datum_rodjenja, datum_upisa, clanarina_vrijedi_do, adresa, grad, postanski_broj, drzava, status, napomena, fitness, bjj, korisnicko_ime, lozinka) 
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
                 
    db.run(sql, [ime_prezime, email || null, telefon, pol, datum_rodjenja, datum_upisa, clanarina_vrijedi_do, adresa, grad, postanski_broj, drzava || 'AT', status || 'Aktivan', napomena, fitness, bjj, korisnicko_ime, lozinka], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ id: this.lastID, korisnicko_ime, message: "Član uspešno sačuvan!" });
    });
});

app.get('/api/admin/clanovi', (req, res) => {
    db.all("SELECT * FROM clanovi ORDER BY ime_prezime ASC", [], (err, rows) => {
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
                 
    db.run(sql, [ime_prezime, email || null, telefon, pol, datum_rodjenja, datum_upisa, clanarina_vrijedi_do, adresa, grad, postanski_broj, drzava, status, napomena, fitness, bjj, id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "Podaci uspešno ažurirani!" });
    });
});

app.get('/api/admin/statistika', (req, res) => {
    const danas = new Date().toISOString().split('T')[0];
    const sqlUkupno = "SELECT COUNT(*) as ukupno FROM clanovi";
    const sqlFitness = "SELECT COUNT(*) as fitness FROM clanovi WHERE fitness = 1 AND clanarina_vrijedi_do >= ?";
    const sqlBjj = "SELECT COUNT(*) as bjj FROM clanovi WHERE bjj = 1 AND clanarina_vrijedi_do >= ?";

    db.get(sqlUkupno, [], (err, rowUkupno) => {
        if (err) return res.status(500).json({ error: err.message });
        db.get(sqlFitness, [danas], (err, rowFitness) => {
            if (err) return res.status(500).json({ error: err.message });
            db.get(sqlBjj, [danas], (err, rowBjj) => {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ ukupno: rowUkupno ? rowUkupno.ukupno : 0, fitness: rowFitness ? rowFitness.fitness : 0, bjj: rowBjj ? rowBjj.bjj : 0 });
            });
        });
    });
});

app.get('/api/admin/rodjendani-ovog-meseca', (req, res) => {
    const tekuciMesec = String(new Date().getMonth() + 1).padStart(2, '0');
    const sql = `SELECT ime_prezime, datum_rodjenja, pol FROM clanovi 
                 WHERE strftime('%m', datum_rodjenja) = ? 
                 ORDER BY strftime('%d', datum_rodjenja) ASC`;
    db.all(sql, [tekuciMesec], (err, rows) => {
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
    db.run(sql, [clan_id, tekst], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        
        // Slanje Push Notifikacije klijentu
        db.get(`SELECT push_pretplata FROM clanovi WHERE id = ?`, [clan_id], (err, row) => {
            if (row && row.push_pretplata) {
                try {
                    const sub = JSON.parse(row.push_pretplata);
                    const payload = JSON.stringify({ naslov: 'Total Fit', tekst: tekst });
                    webpush.sendNotification(sub, payload).catch(e => console.error('Push greška:', e));
                } catch (e) {}
            }
        });

        res.json({ message: "Poruka poslata klijentu!", poruka_id: this.lastID });
    });
});

// Slanje sa mobilnog telefona (ČLAN) -> posiljalac: 'clan'
app.post('/api/admin/poruke/individualna-klijent', (req, res) => {
    const { clan_id, tekst } = req.body;
    const sql = `INSERT INTO poruke (clan_id, posiljalac, tekst) VALUES (?, 'clan', ?)`;
    db.run(sql, [clan_id, tekst], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "Poruka poslata klubu!", poruka_id: this.lastID });
    });
});

// Slanje klupskog grupnog obaveštenja
app.post('/api/admin/poruke/grupna', (req, res) => {
    const { naslov, tekst, filter } = req.body;
    const sql = `INSERT INTO grupne_poruke (naslov, tekst, filter) VALUES (?, ?, ?)`;
    db.run(sql, [naslov, tekst, filter || 'svi'], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        
        // Slanje Push notifikacija svima koji odgovaraju filteru i imaju dozvoljen push
        let query = `SELECT push_pretplata FROM clanovi WHERE push_pretplata IS NOT NULL AND status = 'Aktivan'`;
        if (filter === 'fitness') query += ` AND fitness = 1`;
        if (filter === 'bjj') query += ` AND bjj = 1`;
        
        db.all(query, [], (err, rows) => {
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

        res.json({ message: "Grupno obaveštenje poslato!", grupna_id: this.lastID });
    });
});

// Brisanje klupskog grupnog obaveštenja
app.delete('/api/admin/poruke/grupna/:id', (req, res) => {
    const { id } = req.params;
    db.run("DELETE FROM grupne_poruke WHERE id = ?", [id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "Obaveštenje obrisano!" });
    });
});

// Brisanje individualne poruke iz četa
app.delete('/api/admin/poruke/individualna/:id', (req, res) => {
    const { id } = req.params;
    db.run("DELETE FROM poruke WHERE id = ?", [id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "Poruka trajno obrisana!" });
    });
});

// Istorija razgovora za određenog člana
app.get('/api/admin/poruke/chat/:clan_id', (req, res) => {
    const { clan_id } = req.params;
    db.all("SELECT * FROM poruke WHERE clan_id = ? ORDER BY vreme ASC", [clan_id], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// Označi poruke kao pročitane
app.put('/api/admin/poruke/procitano/:clan_id', (req, res) => {
    const { clan_id } = req.params;
    db.run("UPDATE poruke SET procitano = 1 WHERE clan_id = ? AND posiljalac = 'clan'", [clan_id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "Poruke pročitane" });
    });
});

// Označi sve poruke kao pročitane
app.put('/api/admin/poruke/procitano-sve', (req, res) => {
    db.run("UPDATE poruke SET procitano = 1 WHERE posiljalac = 'clan'", [], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "Sve poruke pročitane" });
    });
});

// Dohvatanje svih klupskih obaveštenja
app.get('/api/admin/grupne-poruke-sve', (req, res) => {
    db.all("SELECT * FROM grupne_poruke ORDER BY id ASC", [], (err, rows) => {
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

    const sql = `SELECT * FROM clanovi WHERE korisnicko_ime = ? AND lozinka = ?`;
    db.get(sql, [korisnicko_ime, lozinka], (err, clan) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        if (!clan) {
            return res.status(401).json({ error: 'Pogrešno korisničko ime ili lozinka.' });
        }
        res.json({ id: clan.id, ime_prezime: clan.ime_prezime });
    });
});

// Ruta za čuvanje push pretplate klijenta
app.post('/api/pretplata', (req, res) => {
    const { clan_id, pretplata } = req.body;
    if (!clan_id || !pretplata) return res.status(400).json({ error: 'Fale podaci.' });
    
    db.run(`UPDATE clanovi SET push_pretplata = ? WHERE id = ?`, [JSON.stringify(pretplata), clan_id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.status(201).json({ message: 'Pretplata sačuvana' });
    });
});

app.listen(PORT, () => console.log(`Server trči na portu ${PORT}`));