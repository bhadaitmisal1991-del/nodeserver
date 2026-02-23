var express = require('express');
var cors = require('cors')
var bodyParser = require("body-parser"); //Used to parse the request and send our response to client
var path = require("path");
var mysql = require('mysql2');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const Razorpay = require('razorpay');
const { networkInterfaces } = require('os');

const nodemailer = require("nodemailer");

var app = express();
app.use(cors());

app.use(express.static(__dirname + '/public'));
app.use(bodyParser.urlencoded({'extended':'true'}));            // parse application/x-www-form-urlencoded
app.use(bodyParser.json());                                     // parse application/json
app.use(bodyParser.json({ type: 'application/vnd.api+json' })); 


var connection = mysql.createConnection({
    host : process.env.AIVEN_MYSQL_HOST,
    user : process.env.AIVEN_MYSQL_USER,
    password : process.env.AIVEN_MYSQL_PASSWORD,
    database : process.env.AIVEN_MYSQL_DBNAME,
	port: 21425,
	ssl: {
        // Read CA certificate from the file uploaded to Render
        ca: fs.readFileSync('/etc/secrets/MYSQL_SSL_CA').toString() 
    }
}); 

/*var connection = mysql.createConnection({
    host : 'bhadaitmisal-bhadaitmisal.h.aivencloud.com',
    user : 'avnadmin',
    password : 'AVNS_ZuGpR80Ew8TMU5YUCvl',
    database : 'defaultdb',
	port: 21425
	
});*/
connection.connect(); 


connection.on('error', function(err) {
    console.error('Caught an error on the connection:', err.message);
    // Implement logic to handle the specific error, e.g., reconnecting
    if (err.code === 'PROTOCOL_CONNECTION_LOST' || err.code === 'ECONNRESET') {
        // Handle a lost connection, perhaps by attempting to re-establish
        console.log('Connection lost. Attempting to reconnect...');
        // ... add reconnection logic here ...
    } else {
        // Re-throw other errors if you cannot handle them
		console.log('Connection lost. Attempting to reconnect...'+err);
        throw err;
    }
});


// Login Endpoint
app.post('/api/login', (req, res) => {
    const { email, password } = req.body;

    connection.query('SELECT * FROM users WHERE email = ?', [email], (err, results) => {
	console.log(results+" Result-- "+results[0])
        if (err || results.length === 0) return res.status(401).send('User not found');

        const user = results[0];
		console.log(email+" "password+" "+user.password+" ");
		console.log(" valid "+bcrypt.compareSync(password, user.password));
        const passwordIsValid = bcrypt.compareSync(password, user.password);

        if (!passwordIsValid) return res.status(401).send('Invalid password');
		

        const token = jwt.sign({ id: user.id }, SECRET_KEY, { expiresIn: '1h' });
        res.status(200).send({ auth: true, token: token });
    });
});	


//******Razor Pay Implementation******
const razorpay = new Razorpay({
  key_id: process.env.key_id, 
  key_secret: process.env.key_secret, 
});

app.post('/api/createOrder', async (req, res) => {
  try {
    const { amount, currency } = req.body;
    const data = await razorpay.orders.create({
      amount: amount * 100, // amount in paise
      currency: currency,
      receipt: 'RCP_ID' + Date.now(),
    });
    res.json({
      amount: data.amount,
      id: data.id
    });
  } catch (error) {
    console.error('Error creating order:', error);
    res.status(500).send('Error creating order');
  }
});

//******Razor Pay Implementation******

// ***** GET Items DATA ******
 app.get('/api/GetItemsData', function(req, res) {    
       connection.query('select * from items',function(err, result){
             if (err){
                res.send(err);
                console.log(err);
             }
             res.json(result)
            })  
    });

// ***** GET Dine In Items DATA ******
 app.get('/api/GetDineInItemsData', function(req, res) {    
       connection.query('select * from dineinitems',function(err, result){
             if (err){
                res.send(err);
                console.log(err);
             }
             res.json(result)
            })  
    });
	
// ******* Add Menu Items *****
 app.post('/api/addBillingMenu', function(req, res) {    
connection.query('INSERT INTO items SET ?', req.body, function(err, result) {
    if(err) throw err;
    res.json(result);
	});	
});	
	
// ***** GET BillNo ******
 app.get('/api/billno', function(req, res) {  
var tmpdate = req.query.date; 
       connection.query("SELECT * FROM bills where date='"+tmpdate+"' ORDER BY billno DESC LIMIT 1",function(err, result){
             if (err){
                res.send(err);
                console.log(err);
             }
             res.json(result)
            })  
});	
	
// ******* Add items into bills table *****
 app.post('/api/add', function(req, res) {
connection.query('INSERT INTO bills SET ?', req.body, function(err, result) {
    if(err) throw err;
    res.json(result);
 });
     
    });
	
// ***** GET item wise sale report ******
 app.get('/api/todaysReport', function(req, res) {  
var itemno = req.query.itemno;
var todaysDate = req.query.todaysDate; 
       connection.query("SELECT items.itemno, items.itemname, items.price, SUM(qty) as qty FROM bills, items where bills.itemno=items.itemno and bills.itemno='"+itemno+"' and bills.date = '"+todaysDate+"' ORDER BY items.itemno",function(err, result){

             if (err){
                res.send(err);
                console.log(err);
             }
             res.json(result)
            })  
    });		
	
// ***** GET item wise sale report ******
 app.get('/api/reportBetweenDate', function(req, res) {  
var itemno = req.query.itemno;
var FromDate = req.query.FromDate; 
var ToDate = req.query.ToDate; 
	 if(ToDate=="undefined")
		ToDate=FromDate;
       connection.query("SELECT items.itemno, items.itemname, items.price, SUM(qty) as qty FROM bills, items where bills.itemno=items.itemno and bills.itemno='"+itemno+"' and bills.date >= '"+FromDate+"' and bills.date <= '"+ToDate+"' ORDER BY items.itemno",function(err, result){

             if (err){
                res.send(err);
                console.log(err);
             }
             res.json(result)
            })  
    });	
	
// ***** GET Vendor DATA ******
 app.get('/api/getVendorData', function(req, res) {   
       connection.query('select * from vendor',function(err, result){

             if (err){
                res.send(err);
                console.log(err);
             }
				res.json(result)
            })  
 });
 
 // ***** Vendor Entry: Check whether existing entry for today's date''******	
app.get('/api/vendorEntryDate', function(req, res) {  
       connection.query("SELECT * FROM vendortransaction where tranDate='"+req.query.tranDate+"' ORDER BY id DESC",function(err, result){

             if (err){
                res.send(err);
                console.log(err);
             }
             res.json(result)
            })  
});

// ***** GET Vendor Balance ******
app.get('/api/getVendorBalance', function(req, res) { 
       connection.query("select * from vendortransaction where vID='"+req.query.vID+"' ORDER BY id DESC LIMIT 1",function(err, result){

             if (err){
                res.send(err);
                console.log(err);
             }            
             res.json(result)
            })  
});


// ***** GET Employee Last Nil Balance Record ******
app.get('/api/getVendorLastNilBalRecord', function(req, res) { 
       connection.query("select * from vendortransaction where vID='"+req.query.vID+"' and balance = 0 ORDER BY id DESC LIMIT 1",function(err, result){

             if (err){
                res.send(err);
                console.log(err);
             }      
             res.json(result)
            })  
});

// ***** GET Vendor Last Nil Balance Record If balance amount 0 not found******
app.get('/api/getVendorLastNilBalRecordBalZeroNotFound', function(req, res) { 
       connection.query("select * from vendortransaction where vID='"+req.query.vID+"' LIMIT 1",function(err, result){

             if (err){
                res.send(err);
                console.log(err);
             }           
             res.json(result)
            })  
});

// ***** GET Vendor Due Records ****** 
app.get('/api/getVendorDueRecords', function(req, res) { 
       connection.query("select * from vendortransaction where id >= '"+req.query.id+"' and  vID = '"+req.query.vID+"' ORDER BY id DESC",function(err, result){

             if (err){
                res.send(err);
                console.log(err);
             }            
             res.json(result)
            })  
});

 
// ******* Add Vendor data *****
 app.post('/api/addVendor', function(req, res) { 
connection.query('INSERT INTO vendor SET ?', req.body, function(err, result) {
   // Neat!
    if(err) throw err;
    res.json(result);
 });	
});	
	
// ***** UPDATE Vendor DATA ******
app.post('/api/updateVendor', function(req, res) {      
	connection.query('UPDATE vendor SET vName = ?, vAdd = ?, mobileNo = ?, vProductName = ? WHERE vID = ?', [req.body.vName, req.body.vAdd, req.body.mobileNo, req.body.vProductName, req.body.vID], 
	function(err, result){
        if(err) throw err;
        res.json(result);
        });     
    });


	
// ***** Add Vendor Bill ******
app.post('/api/addVendorBill', function(req, res) {
	connection.query('INSERT INTO vendortransaction SET ?', req.body, function(err, result) {
    if(err) throw err;
		res.json(result);
	});
 });
	
	
// ***** Search Vendor Bills ******	
app.get('/api/searchVendorBills', function(req, res) {  
	var vID = req.query.vID;
	var startDate = req.query.startDate; 
	var endDate = req.query.endDate; 
       connection.query("SELECT * FROM vendortransaction where vID='"+vID+"' and tranDate >= '"+startDate+"' and tranDate <= '"+endDate+"' ORDER BY id DESC",function(err, result){

             if (err){
                res.send(err);
                console.log(err);
             }
             res.json(result)
            })  
});

// ***** UPDATE Vendor Bills ******
app.post('/api/updateVendorBill', function(req, res) { 
	 
	connection.query('UPDATE vendortransaction SET vID = ?, tranDate = ?,  tranType = ?, amount = ?, note = ? WHERE id = ?', [req.body.vID, req.body.tranDate, req.body.tranType, req.body.amount, req.body.note, req.body.id], 
	function(err, result){
        if(err) throw err;
        res.json(result);
        });
     
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
app.get('/api/getEmpData', function(req, res) {      
     
       connection.query('select * from employees',function(err, result){

             if (err){
                res.send(err);
                console.log(err);
             }            
             res.json(result)
            })  
});


// ***** Add Employee ******
app.post('/api/addEmployee', function(req, res) {     
	connection.query('INSERT INTO employees SET ?', req.body, function(err, result) {
    if(err) throw err;
		res.json(result);
	});
     
    });
	
// ***** UPDATE Employee DATA ******
app.post('/api/updateEmployee', function(req, res) { 	  
	  connection.query("UPDATE employees SET eName = ?, eadd = ?, mobileNo = ?, designation = ?, docID = ?, DOJ = ?   WHERE eno = ?", [req.body.eName, req.body.add, req.body.mobileNo, req.body.designation, req.body.docID, req.body.DOJ, req.body.eno],
	function(err, result){
        if(err) throw err;
        res.json(result);
        });		    
    });
	
// ***** Add Employee Advance******
app.post('/api/addEmployeeAdvance', function(req, res) { 
	connection.query('INSERT INTO empadvance SET ?', req.body, function(err, result) {
    if(err) throw err;
		res.json(result);
	});     
});

// ***** Update Employee Advance******
app.post('/api/updateEmpAdvance', function(req, res) {  
	  connection.query("UPDATE empadvance SET eno = ?, tranDate = ?, tranType = ?, amount = ?, note = ?  WHERE id = ?", [req.body.eno, req.body.tranDate, req.body.tranType, req.body.amount, req.body.note, req.body.id],
	function(err, result){
        if(err) throw err;
        res.json(result);
        });
		    
    });
	
// ***** Search Employee Advance******	
app.get('/api/searchEmpAdvance', function(req, res) {  
	var eno = req.query.eno;
	var startDate = req.query.startDate; 
	var endDate = req.query.endDate;
       connection.query("SELECT * FROM empadvance where eno='"+eno+"' and tranDate >= '"+startDate+"' and tranDate <= '"+endDate+"' ORDER BY tranDate DESC",function(err, result){

             if (err){
                res.send(err);
                console.log(err);
             }
             res.json(result)
            })  
});

// ***** Advance Entry: Check whether existing entry for today's date''******	
app.get('/api/advEntryDate', function(req, res) {  
       connection.query("SELECT * FROM empadvance where tranDate='"+req.query.tranDate+"' ORDER BY id DESC",function(err, result){

             if (err){
                res.send(err);
                console.log(err);
             }
            
             res.json(result)
            })  
});

// ***** GET employee advance Balance ******
app.get('/api/getEmpAdvBalance', function(req, res) { 
       connection.query("select * from empadvance where eno='"+req.query.eno+"' ORDER BY id DESC LIMIT 1",function(err, result){

             if (err){
                res.send(err);
                console.log(err);
             }            
             res.json(result)
            })  
});

// ***** GET Employee Last Nil Balance Record ******
app.get('/api/getEmpLastNilBalRecord', function(req, res) { 
       connection.query("select * from empadvance where eno='"+req.query.eno+"' and balance = 0 ORDER BY id DESC LIMIT 1",function(err, result){

             if (err){
                res.send(err);
                console.log(err);
             }            
             res.json(result)
            })  
});

// ***** GET Employee Last Nil Balance Record If balance amount 0 not found******
app.get('/api/getEmpLastNilBalRecordBalZeroNotFound', function(req, res) { 
       connection.query("select * from empadvance where eno='"+req.query.eno+"' LIMIT 1",function(err, result){

             if (err){
                res.send(err);
                console.log(err);
             }            
             res.json(result)
            })  
});

// ***** GET Employee Due Records ****** 
app.get('/api/getEmpDueRecords', function(req, res) { 
       connection.query("select * from empadvance where id >= '"+req.query.id+"' and  eno = '"+req.query.eno+"' ORDER BY id DESC",function(err, result){

             if (err){
                res.send(err);
                console.log(err);
             }            
             res.json(result)
            })  
});


// ***** Add Sales Calculation ******
app.post('/api/addSaleCalculation', function(req, res) { 
	connection.query('INSERT INTO saleCalculation SET ?', req.body, function(err, result) {
   // Neat!
    if(err) throw err;
		res.json(result);
	});     
});


// ***** get sale calculation yesterday's change amount'******	
app.get('/api/saleCalDate', function(req, res) {  
     
       connection.query("SELECT * FROM salecalculation where sDate='"+req.query.cDate+"'",function(err, result){

             if (err){
                res.send(err);
                console.log(err);
             }
             res.json(result)
            })  
});

// ***** UPDATE sale calculation ******
app.post('/api/updateSaleCalculation', function(req, res) {   


	 //var exec = require('child_process').exec;
	 //var child = exec("C:\xampp\mysql\bin\mysqldump --host=localhost --user=root --password=  bhadaitmisal > DB_Backup\backup_bhadaitmisal.sql");
	 
	 
	// var child = exec ("C:\xampp\mysql\bin\mysqldump--routines -h localhost -u root -p  --single-transaction bhadaitmisal > db3_backup.sql");
	 
	 
	 //var child = exec ("mysqldump --routines --h $dbhost --u $dbuser --p $dbpass --single-transaction $dbname > db3_backup.sql");
  
 // var exec = require('child_process').exec(' mysqldump -u root -p bhadaitmisal > fileName.sql');
 

  
  
  

  
	  connection.query("UPDATE salecalculation SET c2000 = ?, c500 = ?, c200 = ?, c100 = ?, c50 = ?, c20 = ?, c10 = ?, cash = ?, paytm = ?, bhim = ?, sChange = ?, shopSale = ?, laptopSale = ?, swiggy = ?, zomato = ?, expences = ?   WHERE sDate = ?", [req.body.c2000, req.body.c500, req.body.c200, req.body.c100, req.body.c50, req.body.c20, req.body.c10, req.body.cash, req.body.paytm, req.body.bhim, req.body.sChange, req.body.shopSale, req.body.laptopSale, req.body.swiggy, req.body.zomato, req.body.expences, req.body.sDate],
	function(err, result){
        if(err) throw err;
        res.json(result);
        });
		    
    });
	
// ***** Sale calculation report ******
 app.get('/api/getCalcReport', function(req, res) {  
var itemno = req.query.itemno;
var startDate = req.query.startDate; 
var endDate = req.query.endDate; 
       connection.query("SELECT * FROM salecalculation where sDate >= '"+startDate+"' and sDate <= '"+endDate+"' ORDER BY sDate DESC",function(err, result){

             if (err){
                res.send(err);
                console.log(err);
             }
            
             res.json(result)
            })  
    });	
	
// ***** Add Pav Entry******
app.post('/api/addPavEntry', function(req, res) {  
	connection.query('INSERT INTO paventry SET ?', req.body, function(err, result) {
    if(err) throw err;
		res.json(result);
	});     
});

// ***** Pav Entry: Check whether existing entry for today's date''******	
app.get('/api/pavEntryDate', function(req, res) {  
       connection.query("SELECT * FROM paventry where tranDate='"+req.query.tranDate+"' ORDER BY pno DESC",function(err, result){

             if (err){
                res.send(err);
                console.log(err);
             }
             res.json(result)
            })  
});


// ***** UPDATE sale calculation ******
app.post('/api/updatePavEntry', function(req, res) {      
	  
	  connection.query("UPDATE paventry SET orderedPav = ?, returnPav = ?, paidPav = ?, balance = ?, note = ?  WHERE tranDate = ?", [req.body.orderedPav, req.body.returnPav, req.body.paidPav, req.body.balance, req.body.note, req.body.tranDate],
	function(err, result){
        if(err) throw err;
        res.json(result);
        });
		    
    });
	
	
// ***** GET Pav Entry Balance ******
app.get('/api/pavEntryBalance', function(req, res) { 
       connection.query("select * from paventry ORDER BY pno DESC LIMIT 1",function(err, result){

             if (err){
                res.send(err);
                console.log(err);
             }            
             res.json(result)
            })  
});

// ***** GET Last Nil Balance Record ******
app.get('/api/getLastNilBalRecord', function(req, res) { 
       connection.query("select * from paventry where balance = 0 ORDER BY pno DESC LIMIT 1",function(err, result){

             if (err){
                res.send(err);
                console.log(err);
             }            
             res.json(result)
            })  
});

// ***** GET Due Records ****** req.query.pno
app.get('/api/getDueRecords', function(req, res) { 
       connection.query("select * from paventry where pno >= '"+req.query.pno+"' ORDER BY pno DESC",function(err, result){

             if (err){
                res.send(err);
                console.log(err);
             }            
             res.json(result)
            })  
});

	// ***** GET Pav DATA ******
app.get('/api/getPavData', function(req, res) {      
     var startDate = req.query.startDate; 
	 var endDate = req.query.endDate; 
       connection.query("select * from paventry where tranDate >= '"+startDate+"' and tranDate <= '"+endDate+"' ORDER BY pno DESC",function(err, result){

             if (err){
                res.send(err);
                console.log(err);
             }            
             res.json(result)
            })  
});

	// ***** GET Custome Bill Search  ******
app.get('/api/getCustBill', function(req, res) {      
     var billDate = req.query.billDate; 
	 var cname = req.query.cname; 
       connection.query("select * from bills where date = '"+billDate+"' and cname LIKE '%"+cname+"%' ORDER BY billno DESC",function(err, result){

             if (err){
                res.send(err);
                console.log(err);
             }            
             res.json(result)
            })  
});

// ***** GET Farsan Customers DATA ******
app.get('/api/getFarsanCustData', function(req, res) {      
     
       connection.query('select * from farsancustomers',function(err, result){

             if (err){
                res.send(err);
                console.log(err);
             }            
             res.json(result)
            })  
});

// ***** Add Farsan Customer ******
app.post('/api/addFarsanCustomer', function(req, res) { 
	connection.query('INSERT INTO farsancustomers SET ?', req.body, function(err, result) {
   // Neat!
    if(err) throw err;
		res.json(result);
	});
     
    });
	
// ***** UPDATE Farsan Customer DATA ******
app.post('/api/updateFarsanCustomer', function(req, res) {  
	  connection.query("UPDATE farsancustomers SET name = ?, cadd = ?, area = ?, mobileno = ?, joindate = ?   WHERE cno = ?", [req.body.name, req.body.cadd, req.body.area, req.body.mobileno, req.body.joindate, req.body.cno],
	function(err, result){
        if(err) throw err;
        res.json(result);
        });
		    
    });
	

// ***** GET Farsan Custome Bill Balance ******
app.get('/api/getCustBalance', function(req, res) { 
       connection.query("select * from farsanentry where cno='"+req.query.cno+"' ORDER BY id DESC LIMIT 1",function(err, result){
             if (err){
                res.send(err);
                console.log(err);
             }            
             res.json(result)
            })  
});

// ***** Add Employee Advance******
app.post('/api/addFarsanCustEntry', function(req, res) { 
	connection.query('INSERT INTO farsanentry SET ?', req.body, function(err, result) {
    if(err) throw err;
		res.json(result);
	});     
});

// ***** Farsan Bill Entry: Check whether existing entry for today's date''******	
app.get('/api/billEntryDate', function(req, res) { 
       connection.query("SELECT * FROM farsanentry where trandate='"+req.query.trandate+"' ORDER BY id DESC",function(err, result){

             if (err){
                res.send(err);
                console.log(err);
             }
             res.json(result)
            })  
});

// ***** GET Farsan Cust Bill Last Nil Balance Record ******
 app.get('/api/getCustBillLastNilBalRecord', function(req, res) { 
       connection.query("select * from farsanentry where cno='"+req.query.cno+"' and balance = 0 ORDER BY id DESC LIMIT 1",function(err, result){

             if (err){
                res.send(err);
                console.log(err);
             }            
             res.json(result)
            })  
}); 

// ***** GET Farsan Cust Last Nil Balance Record If balance amount 0 not found******
app.get('/api/getCustBillLastNilBalRecordBalZeroNotFound', function(req, res) { 
       connection.query("select * from farsanentry where cno='"+req.query.cno+"' LIMIT 1",function(err, result){

             if (err){
                res.send(err);
                console.log(err);
             }            
             res.json(result)
            })  
}); 



// ***** GET Farsan Cust Due Records ****** 
app.get('/api/getFarsanCustDueRecords', function(req, res) { 
       connection.query("select * from farsanentry where id >= '"+req.query.id+"' and  cno = '"+req.query.cno+"' ORDER BY id DESC",function(err, result){

             if (err){
                res.send(err);
                console.log(err);
             }            
             res.json(result)
            })  
});


// ***** Search Vendor Bills ******	
app.get('/api/searchFarsanCustBills', function(req, res) {  
	var cno = req.query.cno;
	var startDate = req.query.startDate; 
	var endDate = req.query.endDate; 
       connection.query("SELECT * FROM farsanentry where cno='"+cno+"' and packeddate >= '"+startDate+"' and packeddate <= '"+endDate+"' ORDER BY id DESC",function(err, result){

             if (err){
                res.send(err);
                console.log(err);
             }
             res.json(result)
            })  
});

// ***** get Products yearly report ******	
app.get('/api/getYearlyProductsSale', function(req, res) {  
	var cno = req.query.cno;
	var startDate = req.query.year+"-1-1"; 
	var endDate = req.query.year+"-12-31"; 
       connection.query("SELECT * FROM farsanentry where cno='"+cno+"' and packeddate >= '"+startDate+"' and packeddate <= '"+endDate+"' ORDER BY id DESC",function(err, result){

             if (err){
                res.send(err);
                console.log(err);
             }
             res.json(result)
            })  
});

// ***** GET Table Bill ******
 app.get('/api/getBillForTable', function(req, res) {  
var tableNo = req.query.tableNo; 
       connection.query("SELECT * FROM bills where tableno='"+tableNo+"' and billstatus='unpaid'",function(err, result){

             if (err){
                res.send(err);
                console.log(err);
             }
             res.json(result)
            })  
    });

// ***** GET all Kitchen Orders table 500 ie customer parcel******
 app.get('/api/getOrdersByDate', function(req, res) {  
var tableNo = req.query.tableNo; 
       connection.query("SELECT * FROM bills where date='"+req.query.date+"' and tableNo='500' ORDER BY bill_id",function(err, result){

             if (err){
                res.send(err);
                console.log(err);
             }
            
             res.json(result)
            })  
    });	

// ***** GET all Kitchen Orders ******
 app.get('/api/getAllKitchenOrders', function(req, res) {  
var tableNo = req.query.tableNo; 
       connection.query("SELECT * FROM bills where foodstatus='preparing' ORDER BY bill_id",function(err, result){

             if (err){
                res.send(err);
                console.log(err);
             }
            
             res.json(result)
            })  
    });	

// ***** Mark Order Ready From Kitchen ******
app.post('/api/markOrderReady', function(req, res) { 
	 var foodready  = 'ready',  foodpreparing = 'preparing';	 
	connection.query('UPDATE bills SET foodstatus = ? WHERE billno = ? AND foodstatus = ?', [foodready, req.body.billno, foodpreparing], 
	function(err, result){
        if(err) throw err;
        res.json(result);
        });     
});
	
// ***** GET all unpaid Orders ******	
 app.get('/api/getAllUnpaidOrders', function(req, res) {
       connection.query("SELECT tableno, foodstatus FROM bills where billstatus='unpaid' ORDER BY billno",function(err, result){

             if (err){
                res.send(err);
                console.log(err);
             }
             res.json(result)
            })  
});
	
// ***** Mark Order Ready From Kitchen ******
app.post('/api/paidTableBill', function(req, res) {
	 var billStatus  = 'paid';
	 
	connection.query('UPDATE bills SET billstatus = ? WHERE billno = ?', [billStatus, req.body.billno], 
	function(err, result){
        if(err) throw err;
        res.json(result);
        });
     
});

// ***** Mark Order Ready From Kitchen ******
app.post('/api/removeBillItem', function(req, res) { 	 
	connection.query('DELETE from bills WHERE bill_id = ?', [req.body.bill_id], 
	function(err, result){
        if(err) throw err;
        res.json(result);
    });     
});


// ***** Add pending Orders - Bhaji Vadi Coffee******	
app.post('/api/addPendingOrders', function(req, res) {  
	var inserts = [];
	if(Number(req.body.qty_bhaji)>0)
		inserts.push(['B', Number(req.body.qty_bhaji), req.body.cName, req.body.status, req.body.date]);
	if(Number(req.body.qty_vadi)>0)
		inserts.push(['V', Number(req.body.qty_vadi), req.body.cName, req.body.status, req.body.date]);
	if(Number(req.body.qty_coffee)>0)
		inserts.push(['C', Number(req.body.qty_coffee), req.body.cName, req.body.status, req.body.date]);
		
	var sql = "INSERT INTO orders (itemName, qty, cName, status, date) VALUES ?";
		connection.query(sql, [inserts], function(err, result) {
		if(err) throw err;
			res.json(result);
		});
	 
});

// ***** GET all pending Orders - Bhaji Vadi Coffee ******	
 app.get('/api/getAllPendingOrders', function(req, res) {  

       connection.query("SELECT id, itemName, cName, qty FROM orders where date='"+req.query.date+"' AND status='P' ORDER BY status",function(err, result){

             if (err){
                res.send(err);
             }            
				res.json(result);
            })  
});


// ***** Mark Pending Order Ready - Bhaji Vadi Coffee ******
app.post('/api/markPendingOrderReady', function(req, res) { 
	 var status  = 'R';	 
	connection.query('UPDATE orders SET status = ? WHERE id = ?', [status, req.body.id], 
	function(err, result){
        if(err) throw err;
        res.json(result.message);
        });
     
});

// ***** UPDATE Pending Orders DATA - Bhaji Vadi Coffee******
app.post('/api/updatePendingOrders', function(req, res) {
	
	  var tmpQty = 0;
	  if(req.body.qty_bhaji!=undefined){
		tmpQty = req.body.qty_bhaji;
	  }else if(req.body.qty_vadi!=undefined){
		tmpQty = req.body.qty_vadi;
	  }else{
		tmpQty = req.body.qty_coffee;
	  }
	  connection.query("UPDATE orders SET cName = ?, qty = ? WHERE id = ?", [req.body.cName, tmpQty, req.body.id],
	function(err, result){
        if(err) throw err;
        res.json(result.message);
        });		    
});

// ***** Clear Bills Data- Delete Data ******
app.post('/api/clearBills', function(req, res) { 
	connection.query('DELETE from bills WHERE date != ?', [req.body.date], 
	function(err, result){
        if(err) throw err;
        res.json(result.affectedRows);
    });     
});

// ***** Clear Pending Orders- Delete Data ******
app.post('/api/clearPendingOrder', function(req, res) { 
	connection.query('DELETE from orders WHERE date != ?', [req.body.date], 
	function(err, result){
        if(err) throw err;
        res.json(result.affectedRows);
    });     
});

//Get IpAddress
app.get('/api/getIpAdd', function(req, res) {
   var os = require('os'),
     interfaces = os.networkInterfaces(),
     address,
     addresses = [],
     i,
     l,
     interfaceId,
     interfaceArray;

	 for (interfaceId in interfaces) {
		 if (interfaces.hasOwnProperty(interfaceId)) {
			 interfaceArray = interfaces[interfaceId];
			 l = interfaceArray.length;

			 for (i = 0; i < l; i += 1) {

				 address = interfaceArray[i];

				 if (address.family === 'IPv4' && !address.internal) {
					 addresses.push(address.address);
				 }
			 }
		 }
	 }
	res.json(addresses);  
});
	const port = process.env.PORT || 3000;
// Binding express app to port 3000
app.listen(port, '0.0.0.0',function(){
    console.log(`Node server running @ ${port}`)
});