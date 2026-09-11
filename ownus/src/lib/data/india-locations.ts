export interface IndiaStateData {
  state: string;
  type: 'state' | 'ut';
  districts: {
    name: string;
    cities: string[];
  }[];
}

export const INDIAN_STATES_AND_UTS: IndiaStateData[] = [
  // 28 States
  {
    state: 'Andhra Pradesh',
    type: 'state',
    districts: [
      { name: 'Visakhapatnam', cities: ['Visakhapatnam', 'Gajuwaka', 'Anakapalle', 'Bheemunipatnam'] },
      { name: 'Vijayawada (NTR)', cities: ['Vijayawada', 'Nandigama', 'Jaggayyapeta', 'Tiruvuru'] },
      { name: 'Guntur', cities: ['Guntur', 'Tenali', 'Mangalagiri', 'Ponnur'] },
      { name: 'Tirupati', cities: ['Tirupati', 'Srikalahasti', 'Gudur', 'Venkatagiri'] },
      { name: 'Kurnool', cities: ['Kurnool', 'Adoni', 'Yemmiganur', 'Dhone'] },
      { name: 'Anantapur', cities: ['Anantapur', 'Dharmavaram', 'Guntakal', 'Tadipatri'] },
      { name: 'East Godavari', cities: ['Rajahmundry', 'Kakinada', 'Samalkot', 'Mandapeta'] },
      { name: 'Nellore', cities: ['Nellore', 'Kavali', 'Kovur', 'Gudur'] },
    ],
  },
  {
    state: 'Arunachal Pradesh',
    type: 'state',
    districts: [
      { name: 'Papum Pare', cities: ['Itanagar', 'Naharlagun', 'Doimukh', 'Yupia'] },
      { name: 'Tawang', cities: ['Tawang', 'Lumla', 'Jang'] },
      { name: 'West Kameng', cities: ['Bomdila', 'Dirang', 'Bhalukpong'] },
      { name: 'East Siang', cities: ['Pasighat', 'Ruksin', 'Mebo'] },
      { name: 'Changlang', cities: ['Changlang', 'Miao', 'Jairampur'] },
    ],
  },
  {
    state: 'Assam',
    type: 'state',
    districts: [
      { name: 'Kamrup Metropolitan', cities: ['Guwahati', 'Dispur', 'North Guwahati', 'Sonapur'] },
      { name: 'Dibrugarh', cities: ['Dibrugarh', 'Naharkatiya', 'Chabua', 'Moranhat'] },
      { name: 'Cachar', cities: ['Silchar', 'Lakhipur', 'Sonai'] },
      { name: 'Jorhat', cities: ['Jorhat', 'Mariani', 'Titabor', 'Teok'] },
      { name: 'Nagaon', cities: ['Nagaon', 'Dhing', 'Raha', 'Kampur'] },
      { name: 'Sonitpur', cities: ['Tezpur', 'Dhekiajuli', 'Rangapara'] },
    ],
  },
  {
    state: 'Bihar',
    type: 'state',
    districts: [
      { name: 'Patna', cities: ['Patna', 'Danapur', 'Phulwari Sharif', 'Barh', 'Mokama', 'Fatwah'] },
      { name: 'Gaya', cities: ['Gaya', 'Bodh Gaya', 'Sherghati', 'Tekari'] },
      { name: 'Muzaffarpur', cities: ['Muzaffarpur', 'Kanti', 'Motipur', 'Sahebganj'] },
      { name: 'Bhagalpur', cities: ['Bhagalpur', 'Naugachhia', 'Kahalgaon', 'Sultanganj'] },
      { name: 'Darbhanga', cities: ['Darbhanga', 'Benipur', 'Baheri'] },
      { name: 'Purnia', cities: ['Purnia', 'Kasba', 'Banmankhi'] },
    ],
  },
  {
    state: 'Chhattisgarh',
    type: 'state',
    districts: [
      { name: 'Raipur', cities: ['Raipur', 'Birgaon', 'Abhanpur', 'Tilda Newra'] },
      { name: 'Durg', cities: ['Bhilai', 'Durg', 'Kumhari', 'Patan'] },
      { name: 'Bilaspur', cities: ['Bilaspur', 'Bodri', 'Kota', 'Takhatpur'] },
      { name: 'Korba', cities: ['Korba', 'Katghora', 'Dipka'] },
      { name: 'Rajnandgaon', cities: ['Rajnandgaon', 'Dongargarh', 'Gandai'] },
    ],
  },
  {
    state: 'Goa',
    type: 'state',
    districts: [
      { name: 'North Goa', cities: ['Panaji', 'Mapusa', 'Bicholim', 'Pernem', 'Calangute', 'Candolim'] },
      { name: 'South Goa', cities: ['Margao', 'Vasco da Gama', 'Ponda', 'Curchorem', 'Canacona'] },
    ],
  },
  {
    state: 'Gujarat',
    type: 'state',
    districts: [
      { name: 'Ahmedabad', cities: ['Ahmedabad', 'Sanand', 'Dholka', 'Viramgam', 'Bavla', 'Bopal'] },
      { name: 'Surat', cities: ['Surat', 'Bardoli', 'Navsari Road', 'Kamrej', 'Mandvi'] },
      { name: 'Vadodara', cities: ['Vadodara', 'Padra', 'Dabhoi', 'Karjan', 'Waghodia'] },
      { name: 'Rajkot', cities: ['Rajkot', 'Gondal', 'Jetpur', 'Dhoraji', 'Shapar'] },
      { name: 'Gandhinagar', cities: ['Gandhinagar', 'Kalol', 'Mansa', 'Dehgam', 'GIFT City'] },
      { name: 'Kutch', cities: ['Gandhidham', 'Bhuj', 'Anjar', 'Mundra', 'Mandvi'] },
      { name: 'Bhavnagar', cities: ['Bhavnagar', 'Palitana', 'Mahuva', 'Sihor'] },
      { name: 'Jamnagar', cities: ['Jamnagar', 'Sikka', 'Dhrol', 'Kalavad'] },
    ],
  },
  {
    state: 'Haryana',
    type: 'state',
    districts: [
      { name: 'Gurugram', cities: ['Gurugram', 'Manesar', 'Sohna', 'Pataudi', 'Cyber City'] },
      { name: 'Faridabad', cities: ['Faridabad', 'Ballabhgarh', 'NIT Faridabad', 'Old Faridabad'] },
      { name: 'Panipat', cities: ['Panipat', 'Samalkha', 'Israna'] },
      { name: 'Ambala', cities: ['Ambala Cantt', 'Ambala City', 'Barara', 'Naraingarh'] },
      { name: 'Karnal', cities: ['Karnal', 'Gharaunda', 'Taraori', 'Assandh'] },
      { name: 'Panchkula', cities: ['Panchkula', 'Kalka', 'Pinjore', 'Mansa Devi Complex'] },
      { name: 'Sonipat', cities: ['Sonipat', 'Kundli', 'Gannaur', 'Rai', 'Murthal'] },
      { name: 'Rohtak', cities: ['Rohtak', 'Meham', 'Sampla', 'Kalanaur'] },
    ],
  },
  {
    state: 'Himachal Pradesh',
    type: 'state',
    districts: [
      { name: 'Shimla', cities: ['Shimla', 'Kufri', 'Rampur', 'Theog', 'Rohru'] },
      { name: 'Kangra', cities: ['Dharamshala', 'Kangra', 'Palampur', 'Nurpur'] },
      { name: 'Solan', cities: ['Baddi', 'Solan', 'Nalagarh', 'Parwanoo', 'Barotiwala'] },
      { name: 'Kullu', cities: ['Kullu', 'Manali', 'Bhuntar', 'Banjar'] },
      { name: 'Mandi', cities: ['Mandi', 'Sundernagar', 'Sarkaghat', 'Jogindernagar'] },
    ],
  },
  {
    state: 'Jharkhand',
    type: 'state',
    districts: [
      { name: 'Ranchi', cities: ['Ranchi', 'Kanke', 'Namkum', 'Hatia', 'Bundu'] },
      { name: 'East Singhbhum', cities: ['Jamshedpur', 'Ghatshila', 'Jugsalai', 'Mango'] },
      { name: 'Dhanbad', cities: ['Dhanbad', 'Jharia', 'Katras', 'Sindri', 'Chirkunda'] },
      { name: 'Bokaro', cities: ['Bokaro Steel City', 'Chas', 'Bermo', 'Phusro'] },
      { name: 'Hazaribagh', cities: ['Hazaribagh', 'Barkagaon', 'Barhi'] },
    ],
  },
  {
    state: 'Karnataka',
    type: 'state',
    districts: [
      { name: 'Bengaluru Urban', cities: ['Bengaluru', 'Electronic City', 'Whitefield', 'Koramangala', 'Indiranagar', 'HSR Layout', 'Yelahanka'] },
      { name: 'Bengaluru Rural', cities: ['Devanahalli', 'Doddaballapura', 'Hosakote', 'Nelamangala'] },
      { name: 'Mysuru', cities: ['Mysuru', 'Nanjangud', 'Hunsur', 'T. Narasipura'] },
      { name: 'Dakshina Kannada', cities: ['Mangaluru', 'Bantwal', 'Puttur', 'Belthangady', 'Surathkal'] },
      { name: 'Dharwad', cities: ['Hubballi', 'Dharwad', 'Navalgund', 'Kundgol'] },
      { name: 'Belagavi', cities: ['Belagavi', 'Gokak', 'Nippani', 'Chikodi', 'Bailhongal'] },
      { name: 'Tumakuru', cities: ['Tumakuru', 'Tiptur', 'Kunigal', 'Sira'] },
      { name: 'Udupi', cities: ['Udupi', 'Manipal', 'Kundapura', 'Karkala'] },
    ],
  },
  {
    state: 'Kerala',
    type: 'state',
    districts: [
      { name: 'Ernakulam', cities: ['Kochi', 'Kakkanad', 'Aluva', 'Angamaly', 'Perumbavoor', 'Tripunithura'] },
      { name: 'Thiruvananthapuram', cities: ['Thiruvananthapuram', 'Technopark', 'Nedumangad', 'Attingal', 'Neyyattinkara'] },
      { name: 'Kozhikode', cities: ['Kozhikode', 'Vadakara', 'Koyilandy', 'Feroke'] },
      { name: 'Thrissur', cities: ['Thrissur', 'Chalakudy', 'Guruvayur', 'Kunnamkulam', 'Kodungallur'] },
      { name: 'Malappuram', cities: ['Malappuram', 'Manjeri', 'Perinthalmanna', 'Tirur', 'Ponnani'] },
      { name: 'Kannur', cities: ['Kannur', 'Thalassery', 'Payyanur', 'Taliparamba'] },
    ],
  },
  {
    state: 'Madhya Pradesh',
    type: 'state',
    districts: [
      { name: 'Indore', cities: ['Indore', 'Mhow', 'Sanwer', 'Depalpur', 'Pithampur (Industrial)'] },
      { name: 'Bhopal', cities: ['Bhopal', 'Berasia', 'Kolar', 'Mandideep'] },
      { name: 'Jabalpur', cities: ['Jabalpur', 'Sihora', 'Patan', 'Panagar'] },
      { name: 'Gwalior', cities: ['Gwalior', 'Dabra', 'Bhitarwar', 'Morar'] },
      { name: 'Ujjain', cities: ['Ujjain', 'Nagda', 'Mahidpur', 'Tarana'] },
    ],
  },
  {
    state: 'Maharashtra',
    type: 'state',
    districts: [
      { name: 'Mumbai City', cities: ['South Mumbai', 'Nariman Point', 'BKC', 'Colaba', 'Dadar', 'Worli'] },
      { name: 'Mumbai Suburban', cities: ['Andheri', 'Bandra', 'Borivali', 'Goregaon', 'Powai', 'Kurla', 'Malad'] },
      { name: 'Pune', cities: ['Pune', 'Pimpri-Chinchwad', 'Hinjewadi', 'Kharadi', 'Hadapsar', 'Kothrud', 'Chakan'] },
      { name: 'Thane', cities: ['Thane', 'Kalyan', 'Dombivli', 'Mira-Bhayandar', 'Ulhasnagar', 'Bhiwandi'] },
      { name: 'Nagpur', cities: ['Nagpur', 'Kamptee', 'Katol', 'Umred', 'MIHAN'] },
      { name: 'Nashik', cities: ['Nashik', 'Malegaon', 'Sinnar', 'Ozar', 'Igatpuri'] },
      { name: 'Aurangabad (Chhatrapati Sambhajinagar)', cities: ['Aurangabad', 'Waluj', 'Shendra', 'Paithan'] },
      { name: 'Raigad', cities: ['Navi Mumbai (Panvel)', 'Khopoli', 'Alibag', 'Mahad', 'Karjat'] },
      { name: 'Kolhapur', cities: ['Kolhapur', 'Ichalkaranji', 'Jaysingpur', 'Kagal'] },
      { name: 'Solapur', cities: ['Solapur', 'Pandharpur', 'Barshi', 'Akkalkot'] },
    ],
  },
  {
    state: 'Manipur',
    type: 'state',
    districts: [
      { name: 'Imphal West', cities: ['Imphal', 'Lamphelpat', 'Uripok', 'Sagolband'] },
      { name: 'Imphal East', cities: ['Porompat', 'Andro', 'Lamlai'] },
      { name: 'Thoubal', cities: ['Thoubal', 'Kakching', 'Lilong'] },
      { name: 'Churachandpur', cities: ['Churachandpur', 'Tuibong'] },
    ],
  },
  {
    state: 'Meghalaya',
    type: 'state',
    districts: [
      { name: 'East Khasi Hills', cities: ['Shillong', 'Cherrapunji (Sohra)', 'Pynursla'] },
      { name: 'West Garo Hills', cities: ['Tura', 'Dalu', 'Tikrikilla'] },
      { name: 'Ri-Bhoi', cities: ['Nongpoh', 'Umiam', 'Byrnihat'] },
      { name: 'West Jaintia Hills', cities: ['Jowai', 'Thadlaskein'] },
    ],
  },
  {
    state: 'Mizoram',
    type: 'state',
    districts: [
      { name: 'Aizawl', cities: ['Aizawl', 'Durtlang', 'Sairang'] },
      { name: 'Lunglei', cities: ['Lunglei', 'Tlabung'] },
      { name: 'Champhai', cities: ['Champhai', 'Zokhawthar'] },
      { name: 'Kolasib', cities: ['Kolasib', 'Vairengte', 'Bairabi'] },
    ],
  },
  {
    state: 'Nagaland',
    type: 'state',
    districts: [
      { name: 'Dimapur', cities: ['Dimapur', 'Chumoukedima', 'Medziphema'] },
      { name: 'Kohima', cities: ['Kohima', 'Tseminyu', 'Jakhama'] },
      { name: 'Mokokchung', cities: ['Mokokchung', 'Changtongya', 'Tuli'] },
    ],
  },
  {
    state: 'Odisha',
    type: 'state',
    districts: [
      { name: 'Khordha', cities: ['Bhubaneswar', 'Jatni', 'Khordha', 'Banapur'] },
      { name: 'Cuttack', cities: ['Cuttack', 'Choudwar', 'Banki', 'Athagarh'] },
      { name: 'Sundargarh', cities: ['Rourkela', 'Sundargarh', 'Rajgangpur'] },
      { name: 'Ganjam', cities: ['Brahmapur', 'Chhatrapur', 'Hinjilicut', 'Gopalpur'] },
      { name: 'Puri', cities: ['Puri', 'Konark', 'Pipili', 'Nimapada'] },
      { name: 'Sambalpur', cities: ['Sambalpur', 'Burla', 'Hirakud', 'Kuchinda'] },
    ],
  },
  {
    state: 'Punjab',
    type: 'state',
    districts: [
      { name: 'Ludhiana', cities: ['Ludhiana', 'Khanna', 'Jagraon', 'Samrala', 'Doraha'] },
      { name: 'Amritsar', cities: ['Amritsar', 'Majitha', 'Ajnala', 'Attari'] },
      { name: 'SAS Nagar (Mohali)', cities: ['Mohali', 'Zirakpur', 'Kharar', 'Dera Bassi', 'Kurali'] },
      { name: 'Jalandhar', cities: ['Jalandhar', 'Phagwara Road', 'Nakodar', 'Goraya'] },
      { name: 'Patiala', cities: ['Patiala', 'Nabha', 'Rajpura', 'Samana'] },
      { name: 'Bathinda', cities: ['Bathinda', 'Rampura Phul', 'Maur', 'Talwandi Sabo'] },
    ],
  },
  {
    state: 'Rajasthan',
    type: 'state',
    districts: [
      { name: 'Jaipur', cities: ['Jaipur', 'Sitapura', 'Bagru', 'Chomu', 'Amer', 'Sanganer'] },
      { name: 'Jodhpur', cities: ['Jodhpur', 'Piparcity', 'Bilara', 'Osian'] },
      { name: 'Udaipur', cities: ['Udaipur', 'Fatehnagar', 'Salumbar', 'Mavli'] },
      { name: 'Kota', cities: ['Kota', 'Ramganj Mandi', 'Sangod', 'Itawa'] },
      { name: 'Alwar', cities: ['Alwar', 'Bhiwadi', 'Neemrana', 'Behror', 'Tijara'] },
      { name: 'Bikaner', cities: ['Bikaner', 'Nokha', 'Lunkaransar', 'Dungargarh'] },
      { name: 'Ajmer', cities: ['Ajmer', 'Kishangarh', 'Beawar', 'Pushkar'] },
      { name: 'Bhilwara', cities: ['Bhilwara', 'Shahpura', 'Mandal', 'Asind'] },
    ],
  },
  {
    state: 'Sikkim',
    type: 'state',
    districts: [
      { name: 'East Sikkim', cities: ['Gangtok', 'Singtam', 'Rangpo', 'Pakyong'] },
      { name: 'South Sikkim', cities: ['Namchi', 'Jorethang', 'Ravangla'] },
      { name: 'West Sikkim', cities: ['Gyalshing', 'Pelling', 'Dentam'] },
      { name: 'North Sikkim', cities: ['Mangan', 'Chungthang', 'Lachung'] },
    ],
  },
  {
    state: 'Tamil Nadu',
    type: 'state',
    districts: [
      { name: 'Chennai', cities: ['Chennai', 'OMR (IT Corridor)', 'Guindy', 'Ambattur', 'T. Nagar', 'Anna Nagar', 'Velachery'] },
      { name: 'Coimbatore', cities: ['Coimbatore', 'Pollachi', 'Mettupalayam', 'Sulur', 'Saravanampatti', 'Tidel Park'] },
      { name: 'Chengalpattu', cities: ['Tambaram', 'Pallavaram', 'Mahabalipuram', 'Maraimalai Nagar', 'Chengalpattu'] },
      { name: 'Kanchipuram', cities: ['Kanchipuram', 'Sriperumbudur', 'Walajabad', 'Oragadam'] },
      { name: 'Tiruppur', cities: ['Tiruppur', 'Avinashi', 'Dharapuram', 'Palladam', 'Udumalaipettai'] },
      { name: 'Madurai', cities: ['Madurai', 'Melur', 'Thirumangalam', 'Usilampatti'] },
      { name: 'Salem', cities: ['Salem', 'Attur', 'Mettur', 'Omalur', 'Sankari'] },
      { name: 'Tiruchirappalli', cities: ['Tiruchirappalli', 'Srirangam', 'Manapparai', 'Thuvakudi'] },
    ],
  },
  {
    state: 'Telangana',
    type: 'state',
    districts: [
      { name: 'Hyderabad', cities: ['Hyderabad', 'HITEC City', 'Gachibowli', 'Madhapur', 'Banjara Hills', 'Jubilee Hills', 'Kukatpally', 'Secunderabad'] },
      { name: 'Medchal-Malkajgiri', cities: ['Kompally', 'Malkajgiri', 'Medchal', 'Alwal', 'Ghatkesar', 'Kushaiguda'] },
      { name: 'Rangareddy', cities: ['Shamshabad', 'Rajendranagar', 'Manikonda', 'Financial District', 'Ibrahimpatnam'] },
      { name: 'Warangal Urban (Hanamkonda)', cities: ['Warangal', 'Hanamkonda', 'Kazipet'] },
      { name: 'Karimnagar', cities: ['Karimnagar', 'Huzurabad', 'Jammikunta', 'Choppadandi'] },
      { name: 'Nizamabad', cities: ['Nizamabad', 'Armoor', 'Bodhan', 'Bheemgal'] },
      { name: 'Khammam', cities: ['Khammam', 'Madhira', 'Sathupalli', 'Wyra'] },
    ],
  },
  {
    state: 'Tripura',
    type: 'state',
    districts: [
      { name: 'West Tripura', cities: ['Agartala', 'Ranirbazar', 'Mohanpur'] },
      { name: 'Gomati', cities: ['Udaipur', 'Amarpur', 'Karbook'] },
      { name: 'South Tripura', cities: ['Belonia', 'Santirbazar', 'Sabroom'] },
      { name: 'North Tripura', cities: ['Dharmanagar', 'Kanchanpur', 'Panisagar'] },
    ],
  },
  {
    state: 'Uttar Pradesh',
    type: 'state',
    districts: [
      { name: 'Gautam Buddha Nagar (Noida)', cities: ['Noida', 'Greater Noida', 'Greater Noida West', 'Dadri', 'Jewar'] },
      { name: 'Lucknow', cities: ['Lucknow', 'Gomti Nagar', 'Hazratganj', 'Alambagh', 'Indira Nagar', 'Chinhat'] },
      { name: 'Ghaziabad', cities: ['Ghaziabad', 'Indirapuram', 'Vaishali', 'Sahibabad', 'Loni', 'Modinagar'] },
      { name: 'Kanpur Nagar', cities: ['Kanpur', 'Kalyanpur', 'Panki', 'Jajmau', 'Govind Nagar'] },
      { name: 'Varanasi', cities: ['Varanasi', 'Ramnagar', 'Shivpur', 'Sarnath'] },
      { name: 'Agra', cities: ['Agra', 'Fatehabad', 'Etmadpur', 'Kheragarh', 'Shamsabad'] },
      { name: 'Prayagraj (Allahabad)', cities: ['Prayagraj', 'Naini', 'Phulpur', 'Jhauwa'] },
      { name: 'Meerut', cities: ['Meerut', 'Sardhana', 'Mawana', 'Hastinapur'] },
      { name: 'Bareilly', cities: ['Bareilly', 'Faridpur', 'Aonla', 'Nawabganj'] },
      { name: 'Aligarh', cities: ['Aligarh', 'Atrauli', 'Khair', 'Iglas'] },
      { name: 'Moradabad', cities: ['Moradabad', 'Kanth', 'Bilari', 'Thakurdwara'] },
      { name: 'Gorakhpur', cities: ['Gorakhpur', 'Sahjanwa', 'Bansgaon', 'GIDA'] },
    ],
  },
  {
    state: 'Uttarakhand',
    type: 'state',
    districts: [
      { name: 'Dehradun', cities: ['Dehradun', 'Rishikesh', 'Mussoorie', 'Vikasnagar', 'Selaqui'] },
      { name: 'Haridwar', cities: ['Haridwar', 'Roorkee', 'SIIDCUL Haridwar', 'Laksar', 'Bhagwanpur'] },
      { name: 'Udham Singh Nagar', cities: ['Rudrapur', 'Pantnagar', 'Kashipur', 'Kichha', 'Sitarganj'] },
      { name: 'Nainital', cities: ['Haldwani', 'Nainital', 'Ramnagar', 'Bhimtal', 'Lalkuan'] },
    ],
  },
  {
    state: 'West Bengal',
    type: 'state',
    districts: [
      { name: 'Kolkata', cities: ['Kolkata', 'Salt Lake (Sector V)', 'New Town', 'Park Street', 'Ballygunge', 'Tollygunge'] },
      { name: 'North 24 Parganas', cities: ['Barasat', 'Barrackpore', 'Dum Dum', 'Bidhannagar', 'Habra', 'Basirhat'] },
      { name: 'South 24 Parganas', cities: ['Alipore', 'Behala', 'Garia', 'Sonarpur', 'Baruipur', 'Budge Budge'] },
      { name: 'Howrah', cities: ['Howrah', 'Bally', 'Uluberia', 'Shibpur', 'Sankrail'] },
      { name: 'Paschim Bardhaman', cities: ['Asansol', 'Durgapur', 'Raniganj', 'Kulti', 'Andal'] },
      { name: 'Darjeeling', cities: ['Siliguri', 'Darjeeling', 'Kurseong', 'Mirik'] },
      { name: 'Hooghly', cities: ['Serampore', 'Chandannagar', 'Chinsurah', 'Uttarpara', 'Dankuni'] },
    ],
  },

  // 8 Union Territories
  {
    state: 'Andaman and Nicobar Islands',
    type: 'ut',
    districts: [
      { name: 'South Andaman', cities: ['Port Blair', 'Garacharma', 'Ferrargunj'] },
      { name: 'North and Middle Andaman', cities: ['Mayabunder', 'Diglipur', 'Rangat'] },
      { name: 'Nicobar', cities: ['Car Nicobar', 'Campbell Bay', 'Nancowry'] },
    ],
  },
  {
    state: 'Chandigarh',
    type: 'ut',
    districts: [
      { name: 'Chandigarh', cities: ['Chandigarh (Sector 1-60)', 'IT Park Chandigarh', 'Industrial Area Phase 1 & 2', 'Manimajra'] },
    ],
  },
  {
    state: 'Dadra and Nagar Haveli and Daman and Diu',
    type: 'ut',
    districts: [
      { name: 'Daman', cities: ['Daman', 'Nani Daman', 'Moti Daman'] },
      { name: 'Diu', cities: ['Diu', 'Ghoghla', 'Fudam'] },
      { name: 'Dadra and Nagar Haveli', cities: ['Silvassa', 'Amli', 'Naroli', 'Khanvel'] },
    ],
  },
  {
    state: 'Delhi (NCT)',
    type: 'ut',
    districts: [
      { name: 'New Delhi', cities: ['Connaught Place', 'Chanakyapuri', 'Barakhamba', 'Lutyens Delhi'] },
      { name: 'South Delhi', cities: ['Saket', 'Hauz Khas', 'Greater Kailash', 'Nehru Place', 'Okhla Industrial Area'] },
      { name: 'South West Delhi', cities: ['Dwarka', 'Vasant Kunj', 'Vasant Vihar', 'Aerocity', 'Najafgarh'] },
      { name: 'West Delhi', cities: ['Janakpuri', 'Rajouri Garden', 'Punjabi Bagh', 'Patel Nagar', 'Kirti Nagar'] },
      { name: 'Central Delhi', cities: ['Karol Bagh', 'Pahar Ganj', 'Daryaganj', 'Jhandewalan'] },
      { name: 'North Delhi', cities: ['Civil Lines', 'Pitampura', 'Rohini', 'Model Town', 'Narela'] },
      { name: 'East Delhi', cities: ['Laxmi Nagar', 'Mayur Vihar', 'Preet Vihar', 'Patparganj Industrial Area'] },
    ],
  },
  {
    state: 'Jammu and Kashmir',
    type: 'ut',
    districts: [
      { name: 'Srinagar', cities: ['Srinagar', 'Lal Chowk', 'Rajbagh', 'Nowgam', 'Batamaloo'] },
      { name: 'Jammu', cities: ['Jammu', 'Bari Brahmana', 'Gandhi Nagar', 'Satwari', 'Akhnoor'] },
      { name: 'Anantnag', cities: ['Anantnag', 'Bijbehara', 'Pahalgam'] },
      { name: 'Baramulla', cities: ['Baramulla', 'Sopore', 'Gulmarg', 'Pattan'] },
      { name: 'Udhampur', cities: ['Udhampur', 'Chenani', 'Ramnagar'] },
    ],
  },
  {
    state: 'Ladakh',
    type: 'ut',
    districts: [
      { name: 'Leh', cities: ['Leh', 'Choglamsar', 'Khaltsi', 'Nubra'] },
      { name: 'Kargil', cities: ['Kargil', 'Drass', 'Sankoo', 'Zanskar'] },
    ],
  },
  {
    state: 'Lakshadweep',
    type: 'ut',
    districts: [
      { name: 'Lakshadweep', cities: ['Kavaratti', 'Agatti', 'Amini', 'Andrott', 'Minicoy'] },
    ],
  },
  {
    state: 'Puducherry',
    type: 'ut',
    districts: [
      { name: 'Puducherry', cities: ['Puducherry City', 'Oulgaret', 'Ariyankuppam', 'Villianur'] },
      { name: 'Karaikal', cities: ['Karaikal', 'Nedungadu', 'Kottucherry'] },
      { name: 'Mahe', cities: ['Mahe', 'Chalakkara'] },
      { name: 'Yanam', cities: ['Yanam', 'Guirempeta'] },
    ],
  },
];
