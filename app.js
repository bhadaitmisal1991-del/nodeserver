const express = require('express');
const cors = require('cors');
const bodyParser = require("body-parser");
const path = require("path");
const mysql = require('mysql2/promise'); // Promise-based for async/await
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const Razorpay = require('razorpay');
const nodemailer = require("nodemailer");

const app = express();
// Middleware
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));


// --- 1. Database Connection Pool ---
const pool = mysql.createPool({
    host: process.env.AIVEN_MYSQL_HOST,
    user: process.env.AIVEN_MYSQL_USER,
    password: process.env.AIVEN_MYSQL_PASSWORD,
    database: process.env.AIVEN_MYSQL_DBNAME,
    port: 21425,
    ssl: {
        ca: fs.readFileSync('/etc/secrets/MYSQL_SSL_CA').toString()
    },
    waitForConnections: true,
    connectionLimit: 15,
    queueLimit: 0
});

// --- 2. Authentication Middleware ---
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    // FIX: split(' ') returns ["Bearer", "TOKEN"]. We need index.
    const token = authHeader && authHeader.split(' '); 
    //console.log("token-"+JSON.stringify(token));
    if (!token) return res.sendStatus(401);
	
	let tempToken = token[0]+" "+token[1];
    jwt.verify(token[1], process.env.JWT_SECRET, (err, user) => {
        if (err) {
            console.error("JWT Verification Error:", err.message);
            return res.sendStatus(403);
        }
        req.user = user;
        next();
    });
};




// Login Endpoint

app.post('/api/register', async (req, res) => {
    try {
        const { email, password } = req.body;
        const salt = bcrypt.genSaltSync(10);
        const hashedPassword = bcrypt.hashSync(password, salt);
        await pool.query('INSERT INTO users (email, password) VALUES (?, ?)', [email, hashedPassword]);
        res.status(201).send({ message: 'User created successfully!' });
    } catch (err) {
        res.status(500).send('Error registering user');
    }
});

app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        // 1. [rows] destructuring gets the data array from the pool
        const [rows] = await pool.query('SELECT * FROM users WHERE email = ?', [email]);

        // 2. Check if the list is empty
        if (!rows || rows.length === 0) {
            return res.status(401).send('User not found');
        }

        // 3. FIX: rows is an array, we need the first object inside it
        const user = rows[0]; 

        // 4. This will now correctly show: [ 'id', 'email', 'password', ... ]
        console.log("Actual Columns in User Object:", Object.keys(user));

        // 5. Check the password field
        if (!user.password) {
            return res.status(500).send('Database Error: password column not found in result');
        }

        const isMatch = bcrypt.compareSync(password, user.password);
        if (!isMatch) {
            return res.status(401).send('Invalid password');
        }

        // 6. Success - Use user.id from the object
        const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET, { expiresIn: '12h' });
        res.status(200).send({ auth: true, token: token });

    } catch (err) {
        console.error("Login Error:", err);
        res.status(500).send('Login error');
    }
});

app.post('/api/addToken', async (req, res) => {
	//const { date, isToken } = req.query;
	const conn = await pool.getConnection();
	try {
		await conn.beginTransaction();
		// 1. Get the last token for TODAY and LOCK the row (FOR UPDATE)
        const [rows] = await conn.query(
            "SELECT billno, tokenNo FROM bills WHERE date = ? AND tableno = 0 ORDER BY billno DESC LIMIT 1 FOR UPDATE",
            [req.body.date]
        );
		console.log("rows ---- "+JSON.stringify(rows));
		console.log("Token No---- "+rows[0].tokenNo);
		let lastToken = (rows.length > 0) ? rows[0].tokenNo : 0;
		console.log("lastToken---- "+lastToken);
		if (lastToken === null || lastToken === undefined) {
            lastToken = 0;
        }
        let newToken;

        // 2. Reset logic: If reaches 100, reset to 1, else +1
        if (lastToken >= 100) {
            newToken = 1;
        } else {
            newToken = lastToken + 1;
        }
		console.log(" newToken Token No---- "+newToken);
		const billData = { ...req.body, tokenNo: newToken };
		
        await conn.query("INSERT INTO bills SET ?", [billData]);
        await conn.commit();
		res.json({ response: 'success', tokenNo: newToken });
	
	} catch (err) {
        // If anything fails, undo changes so the token isn't "lost"
        await conn.rollback();
        console.error("Token Generation Error:", err);
        res.status(500).json({ error: "Failed to generate token", details: err.message });
    } finally {
        // Release the connection back to the pool
        conn.release();
    }
     
});





//******Razor Pay Implementation******
// --- 5. Razorpay & Mail Logic ---
const razorpay = new Razorpay({
    key_id: process.env.key_id,
    key_secret: process.env.key_secret,
});

app.post('/api/createOrder', async (req, res) => {
    try {
        const { amount, currency } = req.body;
        const data = await razorpay.orders.create({
            amount: amount * 100,
            currency: currency,
            receipt: 'RCP_ID' + Date.now(),
        });
        res.json({ amount: data.amount, id: data.id });
    } catch (error) {
        res.status(500).send('Error creating order');
    }
});

//******Razor Pay Implementation******

// ***** GET Items PArcel Menu DATA ******
app.get('/api/GetItemsData', async (req, res) => {
    try {
        const [result] = await pool.query('SELECT * FROM parcelitems');
        res.json(result);
    } catch (err) { res.status(500).send(err); }
});

// ***** GET Dine In Items DATA ******
app.get('/api/GetDineInItemsData', async (req, res) => {
    try {
        const [result] = await pool.query('SELECT * FROM dineinitems');
        res.json(result);
    } catch (err) { res.status(500).send(err); }
});
	
// ***** GET MasterMenu Items DATA ******
app.get('/api/GetMasterItemsData', async (req, res) => {
    try {
        const [result] = await pool.query('SELECT * FROM masteritems');
        res.json(result);
    } catch (err) { res.status(500).send(err); }
});

	
// ******* Add Menu Items *****
 app.post('/api/addBillingMenu', authenticateToken, function(req, res) {    
connection.query('INSERT INTO items SET ?', req.body, function(err, result) {
    if(err) throw err;
    res.json(result);
	});	
});	
	
// ***** GET BillNo ******
 app.get('/api/billno', async (req, res) => {
    const { date, isToken } = req.query;
    try {
        const [result1] = await pool.query(
            "SELECT billno, tokenNo FROM bills WHERE date = ? ORDER BY billno DESC LIMIT 1", 
            [date]
        );
        
        let result2 = null;
        if (isToken === "true") {
            [result2] = await pool.query(
                "SELECT * FROM bills WHERE date = ? AND tableno = 0 ORDER BY billno DESC LIMIT 1",
                [date]
            );
        }
        res.json({ data1: result1, data2: result2 });
    } catch (err) {
        res.status(500).send(err);
    }
});
	
// ******* Add items into bills table *****
app.post('/api/add', async (req, res) => {
    try {
        await pool.query("INSERT INTO bills SET ?", [req.body]);
        res.json({ response: 'success' });
    } catch (err) { res.status(500).send(err); }
});

// ******* Add items into bills table LOCKing api*****

	
// ***** GET item wise sale report ******
app.get('/api/todaysReport', authenticateToken, async (req, res) => {  
    try {
        const { itemno, todaysDate } = req.query;

        const query = `
            SELECT 
                masteritems.itemno, 
                masteritems.itemname, 
                masteritems.price, 
                SUM(bills.qty) as qty 
            FROM bills
            INNER JOIN masteritems ON bills.itemno = masteritems.itemno
            WHERE bills.itemno = ? 
              AND bills.date = ? 
              AND bills.waitername NOT IN ('self-dinein', 'self-parcel')
            GROUP BY masteritems.itemno, masteritems.itemname, masteritems.price
            ORDER BY masteritems.itemno
        `;

        const [result] = await pool.query(query, [itemno, todaysDate]);
        res.json(result);
    } catch (err) {
        console.error("Report Error:", err);
        res.status(500).send("Error generating today's report");
    }
});	
	
// ***** GET item wise sale report ******
app.get('/api/reportBetweenDate', authenticateToken, async (req, res) => {  
    try {
        const { itemno, FromDate } = req.query;
        let ToDate = req.query.ToDate;

        // If ToDate is missing or undefined, default it to FromDate
        if (!ToDate || ToDate === "undefined") {
            ToDate = FromDate;
        }

        const query = `
            SELECT 
                masteritems.itemno, 
                masteritems.itemname, 
                masteritems.price, 
                SUM(bills.qty) as qty 
            FROM bills
            INNER JOIN masteritems ON bills.itemno = masteritems.itemno
            WHERE bills.itemno = ? 
              AND bills.date >= ? 
              AND bills.date <= ? 
              AND bills.waitername NOT IN ('self-dinein', 'self-parcel')
            GROUP BY masteritems.itemno, masteritems.itemname, masteritems.price
            ORDER BY masteritems.itemno
        `;

        const [result] = await pool.query(query, [itemno, FromDate, ToDate]);
        res.json(result);
    } catch (err) {
        console.error("Range Report Error:", err);
        res.status(500).send("Error generating date-range report");
    }
});
	
// ***** GET Vendor DATA ******
app.get('/api/getVendorData', authenticateToken, async (req, res) => {
    try {
        const [result] = await pool.query('SELECT * FROM vendor');
        res.json(result);
    } catch (err) { res.status(500).send(err); }
});
 
 // ***** Vendor Entry: Check whether existing entry for today's date''******	
app.get('/api/vendorEntryDate', authenticateToken, async (req, res) => {  
    try {
        const [result] = await pool.query(
            "SELECT * FROM vendortransaction WHERE tranDate = ? ORDER BY id DESC",
            [req.query.tranDate]
        );
        res.json(result);
    } catch (err) {
        console.error(err);
        res.status(500).send("Error fetching vendor entry date");
    }
});

// ***** GET Vendor Balance ******
app.get('/api/getVendorBalance', authenticateToken, async (req, res) => { 
    try {
        const [result] = await pool.query(
            "SELECT * FROM vendortransaction WHERE vID = ? ORDER BY id DESC LIMIT 1",
            [req.query.vID]
        );
        res.json(result);
    } catch (err) {
        console.error(err);
        res.status(500).send("Error fetching vendor balance");
    }
});


// ***** GET Employee Last Nil Balance Record ******
app.get('/api/getVendorLastNilBalRecord', authenticateToken, async (req, res) => { 
    try {
        const [result] = await pool.query(
            "SELECT * FROM vendortransaction WHERE vID = ? AND balance = 0 ORDER BY id DESC LIMIT 1",
            [req.query.vID]
        );
        res.json(result);
    } catch (err) {
        console.error(err);
        res.status(500).send("Error fetching nil balance record");
    }
});

// ***** GET Vendor Last Nil Balance Record If balance amount 0 not found******
app.get('/api/getVendorLastNilBalRecordBalZeroNotFound', authenticateToken, async (req, res) => { 
    try {
        const [result] = await pool.query(
            "SELECT * FROM vendortransaction WHERE vID = ? LIMIT 1",
            [req.query.vID]
        );
        res.json(result);
    } catch (err) {
        console.error(err);
        res.status(500).send("Error fetching fallback balance record");
    }
});

// ***** GET Vendor Due Records ****** 
app.get('/api/getVendorDueRecords', authenticateToken, async (req, res) => { 
    try {
        const [result] = await pool.query(
            "SELECT * FROM vendortransaction WHERE id >= ? AND vID = ? ORDER BY id DESC",
            [req.query.id, req.query.vID]
        );
        res.json(result);
    } catch (err) {
        console.error(err);
        res.status(500).send("Error fetching due records");
    }
});

 
// ******* Add Vendor data *****
app.post('/api/addVendor', authenticateToken, async (req, res) => { 
    try {
        const [result] = await pool.query('INSERT INTO vendor SET ?', [req.body]);
        res.json(result);
    } catch (err) {
        console.error(err);
        res.status(500).send("Error adding vendor");
    }
});
	
// ***** UPDATE Vendor DATA ******
app.post('/api/updateVendor', authenticateToken, async (req, res) => {      
    try {
        const { vName, vAdd, mobileNo, vProductName, vID } = req.body;
        const [result] = await pool.query(
            'UPDATE vendor SET vName = ?, vAdd = ?, mobileNo = ?, vProductName = ? WHERE vID = ?', 
            [vName, vAdd, mobileNo, vProductName, vID]
        );
        res.json(result);
    } catch (err) {
        console.error(err);
        res.status(500).send("Error updating vendor");
    }
});


	
// ***** Add Vendor Bill ******
app.post('/api/addVendorBill', authenticateToken, async (req, res) => {
    try {
        const [result] = await pool.query('INSERT INTO vendortransaction SET ?', [req.body]);
        res.json(result);
    } catch (err) { res.status(500).send(err); }
});
	
	
// ***** Search Vendor Bills ******	
app.get('/api/searchVendorBills', authenticateToken, async (req, res) => {
    try {
        const { vID, FromDate, ToDate } = req.query;

        // Validation to ensure ToDate is handled if it's sent as a string "undefined"
        const finalToDate = (ToDate && ToDate !== "undefined") ? ToDate : FromDate;

        const query = `
            SELECT * FROM vendortransaction 
            WHERE vID = ? 
            AND tranDate >= ? 
            AND tranDate <= ? 
            ORDER BY id ASC
        `;

        const [results] = await pool.query(query, [vID, FromDate, finalToDate]);
        res.json(results);
    } catch (err) {
        console.error("Search Vendor Bills Error:", err);
        res.status(500).send("Error searching vendor bills");
    }
});

// ***** UPDATE Vendor Bills ******
app.post('/api/updateVendorBill', authenticateToken, async (req, res) => {
    const connection = await pool.getConnection();
    try {
        const { 
            tranDate, vName, vID, billNo, 
            pTotal, pPaid, balance, id 
        } = req.body;

        await connection.beginTransaction();

        const query = `
            UPDATE vendortransaction 
            SET tranDate = ?, vName = ?, vID = ?, billNo = ?, 
                pTotal = ?, pPaid = ?, balance = ? 
            WHERE id = ?
        `;

        const [result] = await connection.query(query, [
            tranDate, vName, vID, billNo, 
            pTotal, pPaid, balance, id
        ]);

        await connection.commit();
        res.json(result);
    } catch (err) {
        // Undo changes if the update fails
        await connection.rollback();
        console.error("Update Vendor Bill Error:", err);
        res.status(500).send("Error updating vendor bill");
    } finally {
        // Return connection to the pool
        connection.release();
    }
});
	
//********** Send Report Mail **************************
app.get("/api/sendDB_BackupMail", (req, res) => {

let reportDetails = {
  'branchName' : req.query.branch  
  }
 
  sendMail("DB_Backup","", reportDetails,(err, info) => {
    /*if (err) {
      console.log(err);
      res.status(400);
      res.send({ error: "Failed to send email" });
    } else { */
      console.log("Email has been sent");
      res.send(info);
   // }
  });
});	
	
//********** Send Report Mail **************************
app.get("/api/sendReportMail", (req, res) => {
 
  let report = req.query.report;  
  report = JSON.parse(report);
  
  let reportDetails = {
  'total': req.query.total,
  'from' : req.query.FromDate,
  'to' : req.query.ToDate,
  'type': req.query.type,
  "generatedOn" : req.query.generatedOn,
  'branchName' : req.query.branch  
  }
  
  sendMail("reportMail",report, reportDetails,(err, info) => {
    /*if (err) {
      console.log(err);
      res.status(400);
      res.send({ error: "Failed to send email" });
    } else { */
      console.log("Email has been sent");
      res.send(info);
   // }
  });
});


async function sendMail(type,report, reportDetails, callback) {
	let reportTable ="";
	let attachement ="";
	let subjectText= reportDetails.branchName+": Bhadait Misal Report";
	if(type=="reportMail"){
		if(reportDetails.type=="auto"){
			reportTable +="<h5><i>**Auto Generated Report**</i></h5>";
		}		
		else{
			reportTable +="<h5><i>**Manual Report**</i></h5>";
			if(reportDetails.from!="undefined" && reportDetails.to!="undefined")
				reportTable +="<h3>Item Wise Report For Date: "+reportDetails.from+" To "+reportDetails.to+"</h3>"
		}
		reportTable +="<span><b>Report Generated on: "+reportDetails.generatedOn+"</b></span>"	
			
		reportTable += "<table border=1 cellpadding=5><tr><th>Iteme Name</th><th>Quantity</th><th>Amount</th></tr>";
		for(i=0;i<report.length;i++){
		
		reportTable+="<tr align='left'><th>"+report[i].itemname+"</th><th>"+report[i].qty+"</th><th>"+report[i].price*report[i].qty+"</th></tr>"
		}
		
		reportTable+="<tr><td colspan=2><b>Total</b></td><td>Rs. "+reportDetails.total+"</td></tr>"
		reportTable+="</table>"
	}
	 
	if(type=="DB_Backup"){
		reportTable="";
		attachement=[{filename:"backup_bhadaitmisal.sql", path:  __dirname + '/DB_Backup/backup_bhadaitmisal.sql' }];
		subjectText=reportDetails.branchName+": Bhadait Misal DB Backup";
	}
	
  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 587,
    secure: false,
    auth: {
      user: "bhadaitmisal1991@gmail.com",
      pass: "bhadait123"
    }
  }); 
  
  const mailOptions = {
  from: `"Bhadait Misal"`,
  to: `"rohitbhadait@gmail.com","bhadaithemant@gmail.com"`,
  subject: subjectText,
  attachments: attachement,
  html: ""+reportTable+""
	};
  
 let info = await transporter.sendMail(mailOptions);
  
  callback(info);
}


// ***** GET Employee DATA ******
app.get('/api/getEmpData', authenticateToken, async (req, res) => {
    try {
        const [result] = await pool.query('SELECT * FROM employees');
        res.json(result);
    } catch (err) { res.status(500).send(err); }
});


// ***** Add Employee ******
app.post('/api/addEmployee', authenticateToken, async (req, res) => { 
    try {
        // req.body should contain { ename, eadd, mobileNo, designation, docID, DOJ, ... }
        const [result] = await pool.query('INSERT INTO employees SET ?', [req.body]);
        
        res.json({
            status: 'success',
            message: 'Employee added successfully',
            insertId: result.insertId
        });
    } catch (err) {
        console.error("Add Employee Error:", err);
        
        // Handle specific DB errors (like duplicate mobile numbers if you have a UNIQUE constraint)
        if (err.code === 'ER_DUP_ENTRY') {
            return res.status(400).send("Employee with this ID or Mobile already exists.");
        }
        
        res.status(500).send("Error adding employee to the database.");
    }
});
	
// ***** UPDATE Employee DATA ******
app.post('/api/updateEmployee', authenticateToken, async (req, res) => {
    try {
        const { eName, add, mobileNo, designation, docID, DOJ, eno } = req.body;
        const [result] = await pool.query(
            "UPDATE employees SET eName=?, eadd=?, mobileNo=?, designation=?, docID=?, DOJ=? WHERE eno=?",
            [eName, add, mobileNo, designation, docID, DOJ, eno]
        );
        res.json(result);
    } catch (err) { res.status(500).send(err); }
});
	
// ***** Add Employee Advance******
app.post('/api/addEmployeeAdvance', authenticateToken, async (req, res) => { 
    try {
        const [result] = await pool.query('INSERT INTO empadvancetransaction SET ?', [req.body]);
        res.json(result);
    } catch (err) {
        console.error(err);
        res.status(500).send("Error adding employee advance");
    }
});

// ***** Update Employee Advance******
app.post('/api/updateEmpAdvance', authenticateToken, async (req, res) => {      
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        const { tranDate, eName, eno, pTotal, pPaid, balance, id } = req.body;
        
        const [result] = await connection.query(
            "UPDATE empadvancetransaction SET tranDate=?, eName=?, eno=?, pTotal=?, pPaid=?, balance=? WHERE id=?", 
            [tranDate, eName, eno, pTotal, pPaid, balance, id]
        );

        await connection.commit();
        res.json(result);
    } catch (err) {
        await connection.rollback();
        console.error(err);
        res.status(500).send("Error updating employee advance");
    } finally {
        connection.release();
    }
});	
// ***** Search Employee Advance******	
app.get('/api/searchEmpAdvance', authenticateToken, async (req, res) => {
    try {
        const { eno, FromDate, ToDate } = req.query;
        const finalToDate = (ToDate && ToDate !== "undefined") ? ToDate : FromDate;

        const [results] = await pool.query(
            "SELECT * FROM empadvancetransaction WHERE eno = ? AND tranDate >= ? AND tranDate <= ? ORDER BY id ASC",
            [eno, FromDate, finalToDate]
        );
        res.json(results);
    } catch (err) {
        console.error(err);
        res.status(500).send("Error searching employee advance");
    }
});

// ***** Advance Entry: Check whether existing entry for today's date''******	
app.get('/api/advEntryDate', authenticateToken, async (req, res) => {  
    try {
        const [result] = await pool.query(
            "SELECT * FROM empadvancetransaction WHERE tranDate = ? ORDER BY id DESC",
            [req.query.tranDate]
        );
        res.json(result);
    } catch (err) {
        console.error(err);
        res.status(500).send("Error fetching advance entry date");
    }
});

// ***** GET employee advance Balance ******
app.get('/api/getEmpAdvBalance', authenticateToken, async (req, res) => { 
    try {
        const [result] = await pool.query(
            "SELECT * FROM empadvancetransaction WHERE eno = ? ORDER BY id DESC LIMIT 1",
            [req.query.eno]
        );
        res.json(result);
    } catch (err) {
        console.error(err);
        res.status(500).send("Error fetching advance balance");
    }
});

// ***** GET Employee Last Nil Balance Record ******
app.get('/api/getEmpLastNilBalRecord', authenticateToken, async (req, res) => { 
    try {
        const [result] = await pool.query(
            "SELECT * FROM empadvancetransaction WHERE eno = ? AND balance = 0 ORDER BY id DESC LIMIT 1",
            [req.query.eno]
        );
        res.json(result);
    } catch (err) {
        console.error(err);
        res.status(500).send("Error fetching nil balance record");
    }
});

// ***** GET Employee Last Nil Balance Record If balance amount 0 not found******
app.get('/api/getEmpLastNilBalRecordBalZeroNotFound', authenticateToken, async (req, res) => { 
    try {
        const [result] = await pool.query(
            "SELECT * FROM empadvancetransaction WHERE eno = ? LIMIT 1",
            [req.query.eno]
        );
        res.json(result);
    } catch (err) {
        console.error(err);
        res.status(500).send("Error fetching fallback balance record");
    }
});

// ***** GET Employee Due Records ****** 
app.get('/api/getEmpDueRecords', authenticateToken, async (req, res) => { 
    try {
        const [result] = await pool.query(
            "SELECT * FROM empadvancetransaction WHERE id >= ? AND eno = ? ORDER BY id DESC",
            [req.query.id, req.query.eno]
        );
        res.json(result);
    } catch (err) {
        console.error(err);
        res.status(500).send("Error fetching due records");
    }
});


// ***** Add Sales Calculation ******
app.post('/api/addSalecalculation', authenticateToken, async (req, res) => { 
    try {
        // req.body contains the counts for 2000, 500, 200, 100, etc.
        const [result] = await pool.query('INSERT INTO salecalculation SET ?', [req.body]);
        res.json({ status: 'success', insertId: result.insertId });
    } catch (err) {
        console.error(err);
        res.status(500).send("Error adding sales calculation");
    }
});


// ***** get sale calculation yesterday's change amount'******	
app.get('/api/saleCalDate', authenticateToken, async (req, res) => {  
    try {
        const [result] = await pool.query(
            "SELECT * FROM salecalculation WHERE sDate = ?",
            [req.query.cDate]
        );
        res.json(result);
    } catch (err) {
        console.error(err);
        res.status(500).send("Error checking sales calculation date");
    }
});

// ***** UPDATE sale calculation ******
app.post('/api/updateSaleCalculation', authenticateToken, async (req, res) => {      
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        const { 
            n2000, n500, n200, n100, n50, n20, n10, n5, n2, n1, 
            totalAmount, date, id 
        } = req.body;

        const query = `
            UPDATE salecalculation 
            SET c2000=?, c500=?, c200=?, c100=?, c50=?, c20=?, c10=?, cash = ?, paytm = ?, bhim = ?, sChange = ?, shopSale = ?, laptopSale = ?, swiggy = ?, zomato = ?, expences = ?   WHERE sDate = ?
        `;
        const [result] = await connection.query(query, [
            req.body.c2000, req.body.c500, req.body.c200, req.body.c100, req.body.c50, req.body.c20, req.body.c10, req.body.cash, req.body.paytm, req.body.bhim, req.body.sChange, req.body.shopSale, req.body.laptopSale, req.body.swiggy, req.body.zomato, req.body.expences, req.body.sDate
        ]);

        await connection.commit();
        res.json(result);
    } catch (err) {
        await connection.rollback();
        console.error(err);
        res.status(500).send("Error updating sales calculation");
    } finally {
        connection.release();
    }
});
	
// ***** Sale calculation report ******
app.get('/api/getCalcReport', authenticateToken, async (req, res) => { 
    try {
        const query = `
            SELECT * FROM salecalculation 
            WHERE sDate >= ? AND sDate <= ? 
            ORDER BY sDate DESC
        `;

        const [results] = await pool.query(query, [req.query.startDate, req.query.endDate]);
        res.json(results);
    } catch (err) {
        console.error(err);
        res.status(500).send("Error fetching sales report");
    }
});
	
// ***** Add Pav Entry******
app.post('/api/addPavEntry', authenticateToken, async (req, res) => { 
    try {
        const [result] = await pool.query('INSERT INTO paventry SET ?', [req.body]);
        res.json({ status: 'success', insertId: result.insertId });
    } catch (err) {
        console.error(err);
        res.status(500).send("Error adding pav entry");
    }
});

// ***** Pav Entry: Check whether existing entry for today's date''******	
app.get('/api/pavEntryDate', authenticateToken, async (req, res) => {  
    try {
        const [result] = await pool.query(
            "SELECT * FROM paventry WHERE tranDate = ? ORDER BY pno DESC",
            [req.query.tranDate]
        );
        res.json(result);
    } catch (err) {
        console.error(err);
        res.status(500).send("Error checking pav entry date");
    }
});


// ***** UPDATE sale calculation ******
app.post('/api/updatePavEntry', authenticateToken, async (req, res) => {      
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        const { tranDate, pName, pID, pTotal, pPaid, balance, id } = req.body;
        
        const query = `
            UPDATE paventry 
            SET tranDate = ?, pName = ?, pID = ?, pTotal = ?, pPaid = ?, balance = ? 
            WHERE id = ?
        `;

        const [result] = await connection.query(query, [
            tranDate, pName, pID, pTotal, pPaid, balance, id
        ]);

        await connection.commit();
        res.json(result);
    } catch (err) {
        await connection.rollback();
        console.error(err);
        res.status(500).send("Error updating pav entry");
    } finally {
        connection.release();
    }
});
	
	
// ***** GET Pav Entry Balance ******
app.get('/api/pavEntryBalance', authenticateToken, async (req, res) => { 
    try {
        const [result] = await pool.query(
            "select * from paventry ORDER BY pno DESC LIMIT 1"
        );
        res.json(result);
    } catch (err) {
        console.error(err);
        res.status(500).send("Error fetching pav balance");
    }
});

// ***** GET Last Nil Balance Record ******
app.get('/api/getLastNilBalRecord', authenticateToken, async (req, res) => { 
    try {
        const [result] = await pool.query(
            "SELECT * FROM paventry WHERE pID = ? AND balance = 0 ORDER BY id DESC LIMIT 1",
            [req.query.pID]
        );
        res.json(result);
    } catch (err) {
        console.error(err);
        res.status(500).send("Error fetching nil balance record");
    }
});

// ***** GET Due Records ****** req.query.pno
app.get('/api/getDueRecords', authenticateToken, async (req, res) => { 
    try {
        const [result] = await pool.query(
            "SELECT * FROM paventry WHERE id >= ? AND pID = ? ORDER BY id DESC",
            [req.query.id, req.query.pID]
        );
        res.json(result);
    } catch (err) {
        console.error(err);
        res.status(500).send("Error fetching pav due records");
    }
});

	// ***** GET Pav DATA ******
app.get('/api/getPavData', authenticateToken, async (req, res) => {
    try {
        const [result] = await pool.query('SELECT * FROM paventry');
        res.json(result);
    } catch (err) {
        console.error(err);
        res.status(500).send("Error fetching pav data");
    }
});

	// ***** GET Custome Bill Search  ******
app.get('/api/getCustBill', authenticateToken, async (req, res) => {  
    try {
        const { cID, date } = req.query;

        // If a date is provided, filter by both Customer ID and Date. 
        // Otherwise, fetch all bills for that customer.
        let query;
        let params;

        if (date && date !== "undefined") {
            query = "SELECT * FROM farsancusttransaction WHERE cID = ? AND tranDate = ? ORDER BY id DESC";
            params = [cID, date];
        } else {
            query = "SELECT * FROM farsancusttransaction WHERE cID = ? ORDER BY id DESC";
            params = [cID];
        }

        const [results] = await pool.query(query, params);
        res.json(results);
    } catch (err) {
        console.error("Get Customer Bill Error:", err);
        res.status(500).send("Error fetching customer bills");
    }
});

// ***** GET Farsan Customers DATA ******
app.get('/api/getFarsanCustData', authenticateToken, async (req, res) => {
    try {
        const [result] = await pool.query('SELECT * FROM farsancustomer');
        res.json(result);
    } catch (err) {
        console.error(err);
        res.status(500).send("Error fetching farsan customer data");
    }
});

// ***** Add Farsan Customer ******
app.post('/api/addFarsanCustomer', authenticateToken, async (req, res) => { 
    try {
        const [result] = await pool.query('INSERT INTO farsancustomer SET ?', [req.body]);
        res.json({ status: 'success', insertId: result.insertId });
    } catch (err) {
        console.error(err);
        res.status(500).send("Error adding farsan customer");
    }
});
	
// ***** UPDATE Farsan Customer DATA ******
app.post('/api/updateFarsanCustomer', authenticateToken, async (req, res) => {      
    try {
        const { cName, cAdd, mobileNo, cID } = req.body;
        const [result] = await pool.query(
            'UPDATE farsancustomer SET cName = ?, cAdd = ?, mobileNo = ? WHERE cID = ?', 
            [cName, cAdd, mobileNo, cID]
        );
        res.json(result);
    } catch (err) {
        console.error(err);
        res.status(500).send("Error updating farsan customer");
    }
});
	

// ***** GET Farsan Custome Bill Balance ******
app.get('/api/getCustBalance', authenticateToken, async (req, res) => { 
    try {
        const [result] = await pool.query(
            "SELECT * FROM farsancusttransaction WHERE cID = ? ORDER BY id DESC LIMIT 1",
            [req.query.cID]
        );
        res.json(result);
    } catch (err) {
        console.error(err);
        res.status(500).send("Error fetching customer balance");
    }
});

// ***** Add Employee Advance******
app.post('/api/addFarsanCustEntry', authenticateToken, async (req, res) => { 
    try {
        const [result] = await pool.query('INSERT INTO farsancusttransaction SET ?', [req.body]);
        res.json({ status: 'success', insertId: result.insertId });
    } catch (err) {
        console.error(err);
        res.status(500).send("Error adding customer entry");
    }
});

// ***** Farsan Bill Entry: Check whether existing entry for today's date''******	
app.get('/api/billEntryDate', authenticateToken, async (req, res) => {  
    try {
        const [result] = await pool.query(
            "SELECT * FROM farsancusttransaction WHERE tranDate = ? ORDER BY id DESC",
            [req.query.tranDate]
        );
        res.json(result);
    } catch (err) {
        console.error(err);
        res.status(500).send("Error checking bill entry date");
    }
});

// ***** GET Farsan Cust Bill Last Nil Balance Record ******
app.get('/api/getCustBillLastNilBalRecord', authenticateToken, async (req, res) => { 
    try {
        const [result] = await pool.query(
            "SELECT * FROM farsancusttransaction WHERE cID = ? AND balance = 0 ORDER BY id DESC LIMIT 1",
            [req.query.cID]
        );
        res.json(result);
    } catch (err) {
        console.error(err);
        res.status(500).send("Error fetching nil balance record");
    }
});

// ***** GET Farsan Cust Last Nil Balance Record If balance amount 0 not found******
app.get('/api/getCustBillLastNilBalRecordBalZeroNotFound', authenticateToken, async (req, res) => { 
    try {
        const [result] = await pool.query(
            "SELECT * FROM farsancusttransaction WHERE cID = ? LIMIT 1",
            [req.query.cID]
        );
        res.json(result);
    } catch (err) {
        console.error(err);
        res.status(500).send("Error fetching fallback record");
    }
});



// ***** GET Farsan Cust Due Records ****** 
app.get('/api/getFarsanCustDueRecords', authenticateToken, async (req, res) => { 
    try {
        const [result] = await pool.query(
            "SELECT * FROM farsancusttransaction WHERE id >= ? AND cID = ? ORDER BY id DESC",
            [req.query.id, req.query.cID]
        );
        res.json(result);
    } catch (err) {
        console.error(err);
        res.status(500).send("Error fetching due records");
    }
});


// ***** Search Vendor Bills ******	
app.get('/api/searchFarsanCustBills', authenticateToken, async (req, res) => {
    try {
        const { cID, FromDate, ToDate } = req.query;
        const finalToDate = (ToDate && ToDate !== "undefined") ? ToDate : FromDate;

        const [results] = await pool.query(
            "SELECT * FROM farsancusttransaction WHERE cID = ? AND tranDate >= ? AND tranDate <= ? ORDER BY id ASC",
            [cID, FromDate, finalToDate]
        );
        res.json(results);
    } catch (err) {
        console.error(err);
        res.status(500).send("Error searching customer bills");
    }
});

// ***** get Products yearly report ******	
app.get('/api/getYearlyProductsSale', authenticateToken, async (req, res) => {
    try {
        const { itemno, year } = req.query;
        // This query sums up quantities grouped by month for a specific item and year
        const query = `
            SELECT MONTH(date) as month, SUM(qty) as totalQty 
            FROM bills 
            WHERE itemno = ? AND YEAR(date) = ? 
            GROUP BY MONTH(date) 
            ORDER BY month ASC
        `;
        const [results] = await pool.query(query, [itemno, year]);
        res.json(results);
    } catch (err) {
        console.error(err);
        res.status(500).send("Error generating yearly sale report");
    }
});

// ***** GET Table Bill ******
app.get('/api/getBillForTable', authenticateToken, async (req, res) => {
    try {
        const { tableNo } = req.query;
        // Fetches items for a table that haven't been 'cleared' or paid yet
        const [results] = await pool.query(
            "SELECT * FROM bills WHERE tableno = ? AND billstatus = 'unpaid'",
            [tableNo]
        );
		//console.log(JSON.stringify(results));
        res.json(results);
    } catch (err) {
        console.error(err);
        res.status(500).send("Error fetching table bill");
    }
});

// ***** GET all Kitchen Orders table 500 ie customer parcel******
app.get('/api/getOrdersByDate', authenticateToken, async (req, res) => {
    try {
        const { date, waiterName } = req.query;
        const [results] = await pool.query(
            "SELECT * FROM bills WHERE date = ? and waitername = ? and foodstatus != '' ORDER BY bill_id",
            [date, waiterName]
        );
        res.json(results);
    } catch (err) {
        console.error(err);
        res.status(500).send("Error fetching orders");
    }
});

// ***** GET all Kitchen Orders ******
app.get('/api/getAllKitchenOrders', authenticateToken, async (req, res) => {
    try {
        const { waiterName } = req.query;
        // Typically used for the KOT (Kitchen Order Ticket) display
        // We filter out self-dinein/parcel if needed, or show all based on your logic
        const [results] = await pool.query(
            "SELECT * FROM bills where foodstatus='preparing' and  waitername=?", 
            [waiterName]
        );
        res.json(results);
    } catch (err) {
        console.error(err);
        res.status(500).send("Error fetching kitchen orders");
    }
});

// ***** Mark Order Ready From Kitchen ******
app.post('/api/markOrderReady', authenticateToken, async (req, res) => {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        // Expects bill_id or unique ID to mark a specific item/order as prepared
        const { id, isReady } = req.body;

        const [result] = await connection.query(
            "UPDATE bills SET isReady = ? WHERE id = ?",
            [isReady, id]
        );

        await connection.commit();
        res.json({ status: 'success', affectedRows: result.affectedRows });
    } catch (err) {
        await connection.rollback();
        console.error("Mark Order Ready Error:", err);
        res.status(500).send("Error updating order status");
    } finally {
        connection.release();
    }
});
	
// ***** GET all unpaid Orders ******	
app.get('/api/getAllUnpaidOrders', authenticateToken, async (req, res) => {
    try {
        const { date } = req.query;

        // Fetches all orders for the day where payment is pending
        // Adjust 'status' or 'isPaid' column name based on your actual schema
        const query = "SELECT tableno, foodstatus FROM bills where billstatus='unpaid' ORDER BY billno";

        const [results] = await pool.query(query, [date]);
        res.json(results);
    } catch (err) {
        console.error("Fetch Unpaid Orders Error:", err);
        res.status(500).send("Error fetching unpaid orders");
    }
});
	
// ***** Mark Order Ready From Kitchen ******
app.post('/api/paidTableBill', authenticateToken, async (req, res) => {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
		var billStatus  = 'paid';
        const { billno } = req.body;

        // Move items to a history/archive if needed, or update status
        // Here we update waitername to 'paid' or a similar identifier
        const [result] = await connection.query(
            "UPDATE bills SET billstatus = ? WHERE billno = ?",
            [ billStatus, billno]
        );

        await connection.commit();
        res.json({ status: 'success', affectedRows: result.affectedRows });
    } catch (err) {
        await connection.rollback();
        console.error("Paid Table Bill Error:", err);
        res.status(500).send("Error processing payment");
    } finally {
        connection.release();
    }
});

// ***** Mark Order Ready From Kitchen ******
app.post('/api/removeBillItem', authenticateToken, async (req, res) => {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        const { bill_id } = req.body; // Unique ID of the row in bills table

        const [result] = await connection.query("DELETE FROM bills WHERE bill_id = ?", [bill_id]);

        await connection.commit();
        res.json({ status: 'success', message: 'Item removed' });
    } catch (err) {
        await connection.rollback();
        res.status(500).send("Error removing item");
    } finally {
        connection.release();
    }
});


// ***** Add pending Orders - Bhaji Vadi Coffee******	
app.post('/api/addPendingOrders', authenticateToken, async (req, res) => {
    try {
	
	var inserts = [];
	if(Number(req.body.qty_bhaji)>0)
		inserts.push(['B', Number(req.body.qty_bhaji), req.body.cName, req.body.status, req.body.date]);
	if(Number(req.body.qty_vadi)>0)
		inserts.push(['V', Number(req.body.qty_vadi), req.body.cName, req.body.status, req.body.date]);
	if(Number(req.body.qty_coffee)>0)
		inserts.push(['C', Number(req.body.qty_coffee), req.body.cName, req.body.status, req.body.date]);
	
        // req.body is an array or object containing order details
        const [result] = await pool.query("INSERT INTO orders (itemName, qty, cName, status, date) VALUES (?, ?, ?, ?, ?)", 
    [inserts[0][0], inserts[0][1], inserts[0][2], inserts[0][3], inserts[0][4]]);
		
        res.json({ status: 'success', insertId: result.insertId });
    } catch (err) {
		console.log(err);
        res.status(500).send("Error adding pending order");
    }
});

// ***** GET all pending Orders - Bhaji Vadi Coffee ******	
app.get('/api/getAllPendingOrders', authenticateToken, async (req, res) => {
    try {
        const { date } = req.query;
        // Show orders that are NOT ready yet, oldest first
        const [results] = await pool.query(
            "SELECT id, itemName, cName, qty FROM orders WHERE date = ? AND status='P' ORDER BY status",
            [date]
        );
        res.json(results);
    } catch (err) {
        res.status(500).send("Error fetching pending orders");
    }
});


// ***** Mark Pending Order Ready - Bhaji Vadi Coffee ******
app.post('/api/markPendingOrderReady', authenticateToken, async (req, res) => {
    try {
        const { id } = req.body;
        const [result] = await pool.query(
            "UPDATE pendingorders SET isReady = 1 WHERE id = ?",
            [id]
        );
        res.json({ status: 'success' });
    } catch (err) {
        res.status(500).send("Error updating order status");
    }
});

// ***** UPDATE Pending Orders DATA - Bhaji Vadi Coffee******
app.post('/api/updatePendingOrders', authenticateToken, async (req, res) => {
    try {
        const { qty, id } = req.body;
        const [result] = await pool.query(
            "UPDATE pendingorders SET qty = ? WHERE id = ?",
            [qty, id]
        );
        res.json({ status: 'success' });
    } catch (err) {
        res.status(500).send("Error updating order");
    }
});

// ***** Clear Bills Data- Delete Data ******
app.post('/api/clearBills', authenticateToken, async (req, res) => {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        // 1. Copy specific customer info to a permanent storage table
        const copyQuery = `
            INSERT INTO customerData (bill_id, cname, mobileno, waitername) 
            SELECT bill_id, cname, mobileno, waitername 
            FROM bills 
            WHERE waitername IN ('self-dinein', 'self-parcel')
        `;
        await connection.query(copyQuery);

        // 2. Delete all records EXCEPT for the current date provided
        const deleteQuery = "DELETE FROM bills WHERE date != ?";
        const [result] = await connection.query(deleteQuery, [req.body.date]);

        await connection.commit();
        res.json({ status: 'success', deletedRows: result.affectedRows });
    } catch (err) {
        await connection.rollback();
        console.error("Clear Bills Error:", err);
        res.status(500).send("Error clearing bills");
    } finally {
        connection.release();
    }
});

// ***** Clear Pending Orders- Delete Data ******
app.post('/api/clearPendingOrder', authenticateToken, async (req, res) => {
    try {
        // Typically used at the end of the shift to wipe the KOT screen
        const [result] = await pool.query("DELETE FROM pendingorders WHERE date = ?", [req.body.date]);
        res.json({ status: 'success', deletedRows: result.affectedRows });
    } catch (err) {
        console.error(err);
        res.status(500).send("Error clearing pending orders");
    }
});

// ***** GET restaurant Info  ******
app.get('/api/restaurantInfo', async (req, res) => {  
    try {
        const [result] = await pool.query("SELECT dinein_online, parcel_online FROM restaurantInfo LIMIT 1");
        res.json(result);
    } catch (err) {
        console.error(err);
        res.status(500).send("Error fetching restaurant info");
    }
});

// ***** UPDATE restaurant info ******
app.post('/api/updateResturantInfo', authenticateToken, async (req, res) => {      
    try {
        const { dineinOnline, parcelOnline } = req.body;
        
        // We assume the settings are stored in row with ID 1
        const [result] = await pool.query(
            'UPDATE restaurantInfo SET dinein_online = ?, parcel_online = ? WHERE id = 1', 
            [dineinOnline, parcelOnline]
        );
        res.json(result);
    } catch (err) {
        console.error(err);
        res.status(500).send("Error updating restaurant settings");
    }
});


	const port = process.env.PORT || 3000;
// Binding express app to port 3000
app.listen(port, '0.0.0.0',function(){
    console.log(`Node server running @ ${port}`)
});