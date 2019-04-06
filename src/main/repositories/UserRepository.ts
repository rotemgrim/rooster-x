import {Service} from "typedi";
import {Connection} from "typeorm";
import {InjectConnection} from "typeorm-typedi-extensions";
import {User} from "../../entity/User";

@Service()
export class UserRepository {

    @InjectConnection("reading")
    private connection: Connection;

    public getAllUsers() {
        const userRepo = this.connection.manager.getRepository(User);
        return userRepo.find();
    }

    public getUser(id) {
        console.log("find user by id", id);
        const userRepo = this.connection.manager.getRepository(User);
        return userRepo.findOne(id);
    }

    public createUser(payload: User) {
        console.log(payload);
        const userRepo = this.connection.manager.getRepository(User);
        const user = new User();
        user.firstName = payload.firstName;
        user.lastName = payload.lastName;
        user.password = payload.password;
        user.isAdmin = payload.isAdmin;
        return userRepo.insert(user);
    }
}
