"""
serverse name explaination
#below are (front end)
github = web


#below are (front end) and (back end) connectter
cloudfare = cf
vercel = vercel


#below are Data Base (back end)
MongoDB = mongo
google sheet with google cloud bot = sheet



function explaination
called(x) = if x be called by api or other serverse name
(serverse name a).call(serverse name b) = serverse name a call  serverse name b. example: web.call(cf) this means github call cloudflare
(serverse name a).call(serverse name b).returnner = a property which saved data that serverse name b return to serverse name a
read() = web need to read data in google sheet , beacuse of user
edit() = web need to edit data in google sheet , beacuse of user
"""

class serverse():
    def __init__(self,real_serverse_name):
        self.api_limit = None#you(ai) know the api limit of each serverse
        self.api = 0#how many thimes api be used
        self.name = real_serverse_name
        self.returnner = "see more explain at property returnner setting of method call"
    def call(self,called,IO):
        "IO is input or output"
        self.returnner = f"the data return from {self.name} call {called}"

to_set_up=["web","cf","vercel","mongo","sheet"]
real_name=["Github","Cloudfare","Vercel","MongoDB","Google sheet with Google cloud bot"]
def init():
    local_data=[]
    for rs in range(5):
        local_data.append(serverse(real_name[rs]))
    #作廢 我還是需要variable name 來指向 serverse object
    #取消作廢 ai 想到了辦法讓我可以在全域環境指向serverse object
    #取消作廢 其實這樣並不能讓全域抓到heap_data 也就是說它會被 gc
    return local_data

data=init()
#init system variable
web=data[0]
cf=data[1]
vercel=data[2]
mongo=data[3]#mongo save hashtable + count  always, never move to sheet. the scoreboard include email and the others, we will put email to list1 , the others to list2 , smae index to list1 and list2 means correct. we will save email always on mongo, if mongo full or we just want, we cant put list2 to sheet
sheet=data[4]#with google cloud bot
#api call count 
def cheak_api_use():
    for rs in data:
        if rs.api>rs.api_limit:
            print(f"{rs.name} api be used more than {rs.api_limit}")#ai should tell develop
            exit()
#main
def read():
    what_user_want=[]
    web.call(cf,"O")
    front_end_called=cf
    if "cf fuck up(fuck up include api limit)":
        web.call(vercel)
        front_end_called=vercel

    front_end_called.call(mongo,"O")
    what_user_want.append(front_end_called.returnner)
    front_end_called.call(sheet,"O")
    what_user_want.append(front_end_called.returnner)
    return what_user_want
def edit():
    data_to_edit=[["email of scoreboard(which is google sheet sheet1)"],["other_data of scoreboard(which is google sheet sheet1)"]]
    web.call(cf,"I")
    front_end_called=cf
    if "cf fuck up(fuck up include api limit)":
        web.call(vercel)
        front_end_called=vercel
    front_end_called.call(mongo,"I")#try save data_to_edit[0] to list1
    if "mongo full, cant input":
        print("save mongo list1 to sheet")#now mongo not full
        front_end_called.call(mongo,"I")#try save data_to_edit[0] to list1  . if still full , thats mean there is million times playing. or we can create player list hash table.
    front_end_called.call(mongo,"I")#try save data_to_edit[1] to list2
    if "mongo full, cant input":
        print("save mongo list2 to sheet")#now mongo not full
        front_end_called.call(sheet,"I")#try save data_to_edit[1] to list2  . if still full , thats mean there is million times playing. or we can create player list hash table.
    
    if "scoreboard now more than 1000 times":
        "we should remove the last one"
        "mongo and sheet still connect with index"
        
# new hashtable , now all set up on sheet , mongo is futurn goal
 

# ======================================================
# ALL API OPTIONS CHECKLIST (History & Current)
# ======================================================

# Option 1: Direct Connection (Not Recommended)
# Description: Web directly accesses Google Sheets.
# Pros: Simple. Cons: Insecure (Keys exposed).
def option_1_direct():
    web.call(sheet, "IO")

# Option 2: Cloudflare Workers (Middleware)
# Description: Web calls Cloudflare, Cloudflare calls Sheet.
# Pros: Fast. Cons: Setup complexity.
def option_2_cloudflare():
    web.call(cf, "IO")
    cf.call(sheet, "IO")

# Option 3: Vercel Serverless (Current Selection)
# Description: Web calls Vercel, Vercel calls Sheet.
# Pros: Secure, Free Tier, Easy Node.js integration.
# Current Schema: Web -> Vercel (Auth/Hash) -> Sheet (UserMap/Counts/ScoreBoard)
def option_3_vercel():
    web.call(vercel, "IO")
    vercel.call(sheet, "IO")

# Option 4: MongoDB Hybrid (High Scale)
# Description: Use Mongo for high-speed writes, sync to Sheet for backup/view.
# Pros: Very Fast. Cons: Two databases to manage.
def option_4_mongo_hybrid():
    web.call(vercel, "IO")
    vercel.call(mongo, "IO")
    vercel.call(sheet, "IO") # Background Sync
